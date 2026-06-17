// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/*  SiteAudit — pay-per-task audit jobs on ARC, settled in native USDC.

    A requester (a person, or another agent over x402) pays the current price and
    names a URL. The fee is ESCROWED in this contract — it is not released on faith.
    An autonomous auditor agent fetches the site off-chain, scans it (SEO, speed,
    security headers), and posts a headline score plus a keccak256 commitment to the
    full report. ONLY then does the escrow release — in full — to that agent. If the
    agent never delivers within the immutable refund window, the payer reclaims 100%.

    Money moves on proof of work, not on faith:
      - no owner/admin can ever touch the escrow,
      - no protocol fee, no treasury, no third destination,
      - every wei that enters has exactly one guaranteed exit (auditor on report,
        or payer on refund),
      - the contract is never a vault: balance == sum of paid over open jobs.

    The chain cannot prove the scan happened (true of any oracle). It DOES prove who
    paid, what URL, how much, when, that the designated agent posted a score plus a
    tamper-evident report hash, and that the fee released only against that report —
    else the money comes back.
*/

contract SiteAudit {
    // ── roles ────────────────────────────────────────────────────────────────
    address public owner;    // deployer; may rotate the auditor and the price ONLY
    address public auditor;  // the agent address; the ONLY role that can post reports

    // ── pricing (native USDC wei; USDC has 18 decimals on ARC) ───────────────
    uint96  public price;                 // current per-audit fee
    uint96  public immutable minPrice;    // owner can never price below this floor
    uint64  public immutable refundAfter; // seconds after request before a payer may reclaim

    // ── jobs ─────────────────────────────────────────────────────────────────
    enum Status { Requested, Reported, Refunded }

    struct Job {
        address payer;       // who paid for this audit
        uint96  paid;        // fee snapshotted at request (immune to later price changes)
        uint64  requestedAt; // block timestamp of the request
        Status  status;      // Requested → Reported (agent) | Refunded (payer, after timeout)
        uint8   score;       // 0..100 headline score, set by the agent
        address auditor;     // the agent BOUND to this job at request time (packs into this slot)
        string  url;         // the audited URL (immutable receipt of WHAT was scanned)
        string  reportUri;   // the report JSON (inline, < 1024 chars) — verify against reportHash
        bytes32 reportHash;  // keccak256 of the full report body — tamper-evidence
    }

    uint256 public jobCount;
    mapping(uint256 => Job) private jobs;

    // running tallies (cosmetic; never gate money)
    uint256 public reportedCount;
    uint256 public refundedCount;
    uint256 public paidVolume; // total USDC released to the auditor over reported jobs

    // ── events ───────────────────────────────────────────────────────────────
    event AuditRequested(uint256 indexed jobId, address indexed payer, string url, uint256 paid);
    event ReportSubmitted(uint256 indexed jobId, address indexed auditor, uint8 score, string reportUri, bytes32 reportHash);
    event AuditRefunded(uint256 indexed jobId, address indexed payer, uint256 amount);
    event AuditorChanged(address indexed previous, address indexed next);
    event PriceChanged(uint96 previous, uint96 next);

    // ── errors ───────────────────────────────────────────────────────────────
    error NotOwner();
    error NotAuditor();
    error NotPayer();
    error ZeroAddress();
    error BadPrice();
    error BadUrl();
    error BadScore();
    error BadReport();
    error WrongPayment();
    error NotOpen();
    error TooEarly();
    error TransferFailed();
    error NoLooseFunds();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address auditor_, uint96 price_, uint96 minPrice_, uint64 refundAfter_) {
        if (auditor_ == address(0)) revert ZeroAddress();
        if (minPrice_ == 0) revert BadPrice();
        if (price_ < minPrice_) revert BadPrice();
        if (refundAfter_ == 0) revert TooEarly();
        owner = msg.sender;
        auditor = auditor_;
        price = price_;
        minPrice = minPrice_;
        refundAfter = refundAfter_;
        emit AuditorChanged(address(0), auditor_);
        emit PriceChanged(0, price_);
    }

    // ── request an audit (anyone: a person or an agent) ──────────────────────
    // Pays EXACTLY the current price; the fee is held in escrow until the agent
    // reports (released to the agent) or the timeout elapses (refunded to payer).
    function requestAudit(string calldata url) external payable returns (uint256 jobId) {
        uint256 len = bytes(url).length;
        if (len == 0 || len > 2048) revert BadUrl();
        // exact payment; price >= minPrice is an invariant maintained on every write
        if (msg.value != price || price < minPrice) revert WrongPayment();

        jobId = ++jobCount;
        jobs[jobId] = Job({
            payer: msg.sender,
            paid: uint96(msg.value),
            requestedAt: uint64(block.timestamp),
            status: Status.Requested,
            score: 0,
            auditor: auditor, // BIND the current auditor to this job — a later setAuditor can
                              // never redirect THIS escrow (owner is walled off from open funds)
            url: url,
            reportUri: "",
            reportHash: bytes32(0)
        });
        // no external call on the hot path → no reentrancy surface here
        emit AuditRequested(jobId, msg.sender, url, msg.value);
    }

    // ── post the report (auditor agent only) ─────────────────────────────────
    // Releases the exact escrowed fee to the auditor. CEI: state is finalized
    // BEFORE the transfer, and the terminal-status guard makes re-entry a no-op.
    function submitReport(uint256 jobId, uint8 score, string calldata reportUri, bytes32 reportHash) external {
        if (jobId == 0 || jobId > jobCount) revert NotOpen();
        Job storage j = jobs[jobId];
        // pay the auditor BOUND to this job, not the mutable global — owner cannot redirect escrow
        if (msg.sender != j.auditor) revert NotAuditor();
        if (j.status != Status.Requested) revert NotOpen();
        if (score > 100) revert BadScore();
        uint256 rlen = bytes(reportUri).length;
        if (rlen == 0 || rlen > 1024) revert BadReport();

        // ── effects ──
        address paidAuditor = j.auditor;
        uint256 amt = j.paid;
        j.status = Status.Reported;
        j.score = score;
        j.reportUri = reportUri;
        j.reportHash = reportHash;
        reportedCount += 1;
        paidVolume += amt;

        // ── interaction ──
        (bool ok, ) = payable(paidAuditor).call{value: amt}("");
        if (!ok) revert TransferFailed();

        emit ReportSubmitted(jobId, paidAuditor, score, reportUri, reportHash);
    }

    // ── reclaim the fee if the agent never delivered (payer only, after timeout) ─
    function refund(uint256 jobId) external {
        if (jobId == 0 || jobId > jobCount) revert NotOpen();
        Job storage j = jobs[jobId];
        if (msg.sender != j.payer) revert NotPayer();
        if (j.status != Status.Requested) revert NotOpen();
        if (block.timestamp < uint256(j.requestedAt) + refundAfter) revert TooEarly();

        uint256 amt = j.paid;
        j.status = Status.Refunded;
        refundedCount += 1;

        (bool ok, ) = payable(j.payer).call{value: amt}("");
        if (!ok) revert TransferFailed();

        emit AuditRefunded(jobId, j.payer, amt);
    }

    // ── admin: rotate the agent / reprice (never touches escrow) ──────────────
    function setAuditor(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AuditorChanged(auditor, next);
        auditor = next;
    }

    function setPrice(uint96 next) external onlyOwner {
        if (next < minPrice) revert BadPrice();
        emit PriceChanged(price, next);
        price = next;
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        owner = next;
    }

    // ── views ────────────────────────────────────────────────────────────────
    function getJob(uint256 jobId)
        external
        view
        returns (
            address payer,
            uint96 paid,
            uint64 requestedAt,
            uint8 status,
            uint8 score,
            address jobAuditor,
            string memory url,
            string memory reportUri,
            bytes32 reportHash
        )
    {
        Job storage j = jobs[jobId];
        return (j.payer, j.paid, j.requestedAt, uint8(j.status), j.score, j.auditor, j.url, j.reportUri, j.reportHash);
    }

    // True once the refund window has elapsed and the job is still open.
    function isRefundable(uint256 jobId) external view returns (bool) {
        Job storage j = jobs[jobId];
        return j.status == Status.Requested && block.timestamp >= uint256(j.requestedAt) + refundAfter;
    }

    // Open escrow currently held for a job (0 unless still Requested).
    function escrowOf(uint256 jobId) external view returns (uint256) {
        Job storage j = jobs[jobId];
        return j.status == Status.Requested ? j.paid : 0;
    }

    // ── no loose money: refuse any plain transfer so balance stays accountable ─
    receive() external payable {
        revert NoLooseFunds();
    }

    fallback() external payable {
        revert NoLooseFunds();
    }
}
