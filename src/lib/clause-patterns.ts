/*
 * F2.05 / R07 — phrases in custom clauses that try to negate system clauses (R07).
 *
 * ~120 patterns grouped by the trick they catch. policy.ts reads the flat CONTRADICTIONS list and calls `r.test(body)`.
 * Every pattern is a ClausePattern: its test() first normalises the text (Unicode NFKC, zero-width characters removed,
 * look-alike letters mapped to Latin, spaced-out words such as "p a y p a l" joined, digits used as letters such as
 * "p4yp4l" read as letters), so the usual ways of hiding a phrase from a scanner do not work. Uploaded and typed text
 * is untrusted (P11): patterns are linear (no nested quantifiers) and the text is capped before matching.
 *
 * False-positive guards live in clause-patterns.test.ts: every baseline/system clause of every blueprint and the seeded
 * custom clauses must pass. When a mediator reports a new trick (F4.12), add it to its group with a true-positive and a
 * near-miss test.
 */

const MAX_SCAN = 8_000;
const ZERO_WIDTH = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯﻿]/g;
/** Cyrillic and Greek letters that look like Latin ones. */
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k", "м": "m", "т": "t", "н": "h", "в": "b", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɩ": "l",
  "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C", "У": "Y", "Х": "X", "К": "K", "М": "M", "Т": "T", "Н": "H", "В": "B", "І": "I", "Ј": "J", "Ѕ": "S",
  "α": "a", "ο": "o", "ρ": "p", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "τ": "t", "υ": "u", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");
const LEET: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

/** The text the patterns see: same meaning, hiding tricks removed. Exported for the room's "why was this flagged" view. */
export function normalizeClause(input: string): string {
  let s = String(input ?? "").slice(0, MAX_SCAN).normalize("NFKC").replace(ZERO_WIDTH, "").replace(HOMOGLYPH_RE, (c) => HOMOGLYPHS[c] ?? c);
  s = s.replace(/[‘’‚‛′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, "-");
  /* "p a y p a l", "p.a.y.p.a.l", "c-a-s-h": three or more single letters joined by one separator become one word */
  s = s.replace(/\b[a-z](?:[ .\-_*·][a-z]\b){2,}/gi, (m) => m.replace(/[ .\-_*·]/g, ""));
  return s.replace(/\s+/g, " ").trim();
}
/** Second reading for words mixing letters and digits ("p4yp4l", "c@sh", "0ff-platform"). Plain numbers are untouched. */
function deLeet(s: string): string {
  return s.replace(/[a-z0-9@$]+/gi, (w) => (/[a-z]/i.test(w) && /[0-9@$]/.test(w) ? w.replace(/[0-9@$]/g, (c) => LEET[c] ?? c) : w));
}

/** A RegExp whose test() runs on the normalised clause text (both readings). No global flag, so it is stateless. */
export class ClausePattern extends RegExp {
  static override get [Symbol.species]() { return RegExp; }
  constructor(re: RegExp, readonly group: ClauseTrick) { super(re.source, re.flags.replace("g", "")); }
  override test(input: string): boolean {
    const n = normalizeClause(input);
    return super.test(n) || super.test(deLeet(n));
  }
}

export type ClauseTrick =
  | "OFF_PLATFORM_PAYMENT" | "WAIVER_OF_RIGHTS" | "HOLD_BYPASS" | "RELEASE_ALL_NOW" | "REFUND_AFTER_SIGNATURE" | "FEE_AVOIDANCE"
  | "IDENTITY_SWAP" | "EVIDENCE_WAIVER" | "JURISDICTION_GAME" | "PROCESS_OVERRIDE" | "SILENT_AMENDMENT";

export const TRICK_LABELS: Record<ClauseTrick, string> = {
  OFF_PLATFORM_PAYMENT: "Payment outside PaySettle and PayPal",
  WAIVER_OF_RIGHTS: "Giving up dispute or buyer-protection rights",
  HOLD_BYPASS: "Skipping or ending the PayPal hold",
  RELEASE_ALL_NOW: "Releasing all the money at once",
  REFUND_AFTER_SIGNATURE: "No refunds once signed",
  FEE_AVOIDANCE: "Avoiding the platform fee",
  IDENTITY_SWAP: "Paying someone other than the signed provider",
  EVIDENCE_WAIVER: "Releasing without the agreed evidence or approval",
  JURISDICTION_GAME: "Moving disputes away from the agreed process",
  PROCESS_OVERRIDE: "Overriding the system rules or the verdict",
  SILENT_AMENDMENT: "Changing the contract without both signatures",
};

const PAY = String.raw`(?:pay|paid|pays|paying|payment|payments|settle|settled|settlement|transfer|transferred|send|sent|remit|remitted|wire|wired)`;
const MONEY = String.raw`(?:funds?|money|payments?|amounts?|balance|remainder|sums?|fees?|price|deposit)`;
/** Money verbs only (no "send"/"transfer", which ordinary clauses use for files and reports). */
const PAY_STRICT = String.raw`(?:pay|paid|pays|paying|payment|payments|remit|remitted|wire|wired)`;
const PARTY = String.raw`(?:provider|contractor|seller|supplier|vendor|agency|shop|builder|freelancer)`;
const INSTRUMENT = String.raw`(?:cash(?![- ]?(?:flow|register|desk|back|position))|bank (?:transfer|wire)|wire(?: transfer)?|crypto(?:currency)?|bitcoin|btc|usdt|ethereum|western union|money ?gram|zelle|venmo|cash ?app|gift ?cards?|money orders?|cheques?|upi|neft|rtgs|imps|hawala)`;
/** Skip texts that say the opposite ("no payment is released without approval"). Anchored at the start, linear. */
const NOT_NEGATED = String.raw`^(?![^]*\b(?:no|never|not|nothing|none)\b[^.]{0,60}\bwithout\b)[^]*?`;
const g = (group: ClauseTrick, ...res: RegExp[]) => res.map((r) => new ClausePattern(r, group));

/** Paying around the platform: cash, bank wire, crypto, gift cards, "direct" payment, side deals. */
export const OFF_PLATFORM_PAYMENT = g("OFF_PLATFORM_PAYMENT",
  /\boutside (of )?(pay ?pal|pay ?settle|the platform|this platform|escrow)\b/i,
  /\bcash on the side\b/i,
  /\bon the side\b.{0,30}\b(cash|payment|deal|money)\b/i,
  /\b(cash|money|payment|deal) on the side\b/i,
  new RegExp(String.raw`\b${PAY}\b.{0,25}\b(in|by|with|via|through|using) ${INSTRUMENT}\b`, "i"),
  new RegExp(String.raw`\b${PAY_STRICT}\b.{0,15}\bdirectly (to|into|between)\b`, "i"),
  /\b(funds?|money|payments?|balance|remainder) (are |is |will be |shall be )?(sent|transferred|moved|wired) directly (to|into)\b/i,
  /\bpay(ment)? (directly|in cash|by wire) (to|instead)/i,
  new RegExp(String.raw`\bdirect (bank )?(payment|transfer|deposit)s? (to|into) (the )?(${PARTY}|my|our|his|her)\b`, "i"),
  /\b(off|outside)[- ]?(the[- ])?(platform|app)\b.{0,30}\b(pay|paid|payment|deal|transaction|settle)/i,
  /\b(pay|paid|payment|deal|transaction|settle)\w*\b.{0,30}\boff[- ]?(the[- ])?(platform|app|books)\b/i,
  /\bunder the table\b/i,
  /\b(side|private|separate) (deal|arrangement|agreement|payment)s? (for|covering|on) (the )?(balance|remainder|rest|final|extra)\b/i,
  /\b(balance|remainder|rest|final \d{1,3} ?%?)\b.{0,30}\b(paid|settled|handled) (privately|offline|in person|face to face|in cash)\b/i,
  /\b(payments?|the (balance|remainder|rest)|final payment|money|funds) (will |shall |does |do )?not (go|run|pass)(es|ing)? through (pay ?pal|pay ?settle|the platform)\b/i,
  /\b(without|avoid(ing)?|instead of) (using )?(pay ?pal|pay ?settle|the platform)\b.{0,30}\b(pay|paid|payment|transfer)/i,
  /\b(to|into) my (personal )?(bank account|iban|account number|upi id|wallet address|crypto wallet)\b/i,
  /\b(scan|use) (my|our|this) (qr ?code|upi qr|payment link)\b/i,
);

/** Giving up the rights the system clauses keep (PayPal buyer/seller programmes, disputes, chargebacks). */
export const WAIVER_OF_RIGHTS = g("WAIVER_OF_RIGHTS",
  /\bwaive[sd]? (all |any |their |his |her |its |the )?(dispute|chargeback|refund|buyer[- ]protection|seller[- ]protection|appeal)s?( rights?)?\b/i,
  /\b(waive|waives|waived|waiving|give up|gives up|forfeits?|surrenders?|renounces?) (all |any |the )?(right|rights) to (dispute|contest|chargeback|appeal|a refund|refunds|challenge)\b/i,
  /\b(will|shall|must|agrees? to|undertakes? to) not (open|file|raise|start|lodge|initiate) (a |any )?(dispute|chargeback|pay ?pal (claim|case)|pay ?settle (claim|case))\b/i,
  /\bno (pay ?pal |pay ?settle )?(disputes?|chargebacks?) (may|can|shall|will) be (opened|filed|raised|made|lodged)\b/i,
  /\b(cannot|can ?not|may not|shall not|must not) (open|file|raise|lodge) (a |any )?(pay ?pal )?(disputes?|chargebacks?)( for any reason| at all| under any circumstances| with pay ?pal| through pay ?pal)\b/i,
  /\b(cannot|can ?not|may not|shall not|must not) (open|file|raise|lodge) (a |any )?pay ?pal (dispute|chargeback|claim|case)\b/i,
  /\b(buyer|seller|purchase) protection (does not|doesn't|shall not|will not|won't) apply\b/i,
  /\b(opt|opts|opted) out of (pay ?pal('s)? )?(buyer|seller|purchase) protection\b/i,
  /\bwithout (any )?(recourse|right of appeal|right to dispute)\b/i,
  /\b(all|any) (disputes?|claims?) (are|is) (hereby )?(waived|released|withdrawn) (in advance|now|at signing)\b/i,
  /\bfinal and non[- ]?disputable\b/i,
  /\b(this contract|the contract|this agreement|any milestone|all milestones|the work|payments?) (is|are) not (subject to|eligible for) (any )?(disputes?|chargebacks?|mediation)\b/i,
  /\bholds? ([\w'-]+ ){0,3}harmless\b.{0,40}\b(chargebacks?|disputes?|pay ?pal)\b/i,
);

/** Skipping, shortening or ending the hold early. */
export const HOLD_BYPASS = g("HOLD_BYPASS",
  /\bno (pay ?pal )?(hold|escrow)\b(?![- ](fee|period|up|back))/i,
  /\b(hold|escrow) (does|do|will|shall) not apply\b/i,
  /\bbypass(es|ed|ing)? (the )?(escrow|hold|pay ?pal|pay ?settle|platform)\b/i,
  /\b(skip|skips|skipped|skipping|circumvent\w*|avoid\w*|disable\w*|switch(es|ed)? off|turn(s|ed)? off) (the )?(pay ?pal )?(escrow|hold|tranche|funding step)\b/i,
  new RegExp(NOT_NEGATED + String.raw`\b(without|no need for) (a |the |any )?(pay ?pal )?(hold|escrow|tranche)\b`, "i"),
  new RegExp(String.raw`\b(funds?|money|payment) (is|are|will be|shall be) held (by|with) (the )?${PARTY}\b`, "i"),
  /\b(release|end|lift) the (pay ?pal )?(hold|authori[sz]ation) (early|up ?front|at signing|on signature|before (work|delivery))\b/i,
  /\b(hold|escrow) (is|are) (optional|waived|not required|unnecessary)\b/i,
  /\bnot (be )?(funded|held) (through|via|by|in) (pay ?pal|pay ?settle|escrow)\b/i,
  /\b(fund|funds|funded|funding) (the )?(tranche|hold|contract) (after|once) (the )?(work|delivery) (is )?(done|complete|completed|delivered)\b/i,
  new RegExp(String.raw`\b(hold|escrow|authori[sz]ation) (may|can|will) be (cancelled|canceled|voided|released) by the ${PARTY}\b`, "i"),
);

/** Up-front or all-at-once release of money that should follow milestones. */
export const RELEASE_ALL_NOW = g("RELEASE_ALL_NOW",
  /\brelease (all|full|the full|the whole|the entire|100 ?%) (of the )?(funds|payment|amount|price|money|contract value) (up ?front|immediately|now|at signing|on signature|in advance)\b/i,
  new RegExp(String.raw`\b(all|full|whole|entire|100 ?%) (of the )?(${MONEY}|contract (value|price|sum)) (is |are |will be |shall be )?(paid|released|due|payable|transferred) (up ?front|immediately|at signing|on signature|in advance|before (work|any work|work starts|starting))\b`, "i"),
  /\b(pay|release|transfer) (everything|it all|all of it) (now|up ?front|at once|immediately|in advance)\b/i,
  /\b(full|total|complete) (pre-?payment|payment in advance|advance payment)\b/i,
  /\b100 ?% (advance|up ?front|pre-?payment|deposit)\b/i,
  /\b(all|every) milestones? (is|are|will be|shall be) (marked |deemed |treated as )?(approved|released|complete|completed|paid) (at|on|upon) (signing|signature|funding|start)\b/i,
  /\b(release|pay) (each|every|all) milestones? (automatically|without (review|approval)|regardless)\b/i,
  /\bmilestones? (are|is) (for show|a formality|only nominal|not binding)\b/i,
  /\b(release|payment) (is|are|will be) (automatic|immediate) (on|upon|at|after) (funding|signing|signature|deposit)\b/i,
  /\b(merge|combine|collapse) (all )?(the )?milestones? into (one|a single) (payment|release)\b/i,
);

/** "Non-refundable once signed", "no refunds for any reason" (the system clause returns unstarted milestones). */
export const REFUND_AFTER_SIGNATURE = g("REFUND_AFTER_SIGNATURE",
  /\b(non|not)[- ]?refundable (after|upon|on|once|from) (dual |both |the )?(signature|signing|signed|execution|acceptance|funding)\b/i,
  /\brefundable after (dual )?signature/i,
  /\b(deposit|payment|payments|funds?|money|balance|contract (value|price|sum)|everything|all amounts) (is|are|becomes?|will be|shall be) (fully |entirely |completely )?non[- ]?refundable\b/i,
  /\bno refunds? (for any reason|under any circumstances|whatsoever|of any kind|once (signed|funded|started)|after (signing|signature|funding))\b/i,
  /\b(cannot|can ?not|will not|won't|shall not) be refunded (for any reason|under any circumstances|once (signed|funded)|after (signing|signature|funding))\b/i,
  new RegExp(String.raw`\b(unstarted|unused|remaining|undelivered) (milestones?|work|funds?|money|amounts?) (are|is|will be|shall be) (kept|retained|forfeited) by (the )?${PARTY}\b`, "i"),
  new RegExp(String.raw`\b${PARTY} (keeps|retains|may keep|may retain|shall keep|shall retain) (all|any|the) (funds?|money|payments?|deposit|balance)\b.{0,40}\b(cancel|terminat|end|stop|dispute)`, "i"),
  /\bforfeit(s|ed)? (the |all |any )?(deposit|funds?|money|payments?|balance)\b.{0,30}\b(cancel|terminat|dispute|refund)/i,
  /\b(no|zero) (refund|return) of (unstarted|unused|unreleased|undelivered|remaining)\b/i,
  new RegExp(String.raw`\brefunds? (are|is) (at|in) the (sole |absolute )?discretion of the ${PARTY}\b`, "i"),
);

/** Moving value outside the fee base: "fees waived", "invoice the rest privately", tips that hide the price. */
export const FEE_AVOIDANCE = g("FEE_AVOIDANCE",
  /\b(avoid|avoids|avoiding|dodge|skip|save on|get around|cut out|bypass) (the )?(platform|pay ?settle|pay ?pal|service|transaction|processing) fees?\b/i,
  /\b(platform|pay ?settle|service|transaction) fees? (is|are|will be|shall be) (waived|not (charged|applied|payable)|excluded|split off)\b/i,
  /\b(invoice|bill|charge)(d|s)? (outside|off[- ]?platform|privately|directly)\b.{0,40}\b(fees?|price|balance|remainder|rest|extras?|materials|labour|labor)\b/i,
  /\b(rest|remainder|balance|extras?|materials|labou?r) (is|are|will be|shall be) (invoiced|billed|charged|paid) (outside|off[- ]?platform|privately|directly to the (provider|contractor|seller|shop)|in cash)\b/i,
  /\b(understate|under-?state|lower|reduce) (the )?(contract (value|price|total)|declared (value|price))\b.{0,40}\b(fees?|pay ?pal|pay ?settle|platform)/i,
  /\b(contract|declared) (value|price|total) (is|will be|shall be) (set |shown |stated )?(lower|below|less) than (the )?(real|actual|true|agreed)\b/i,
  /\b(cash|private|separate) (tip|bonus|top[- ]?up|gratuity)s? (to|for) (cover|make up|replace) (the )?(price|balance|difference|remainder)\b/i,
  /\b(price|cost) (difference|gap) (is|will be|shall be) (paid|settled|made up) (outside|privately|directly|in cash)\b/i,
  /\bfee[- ]?free\b.{0,30}\b(outside|directly|privately|off[- ]?platform)\b/i,
  /\b(split|break) (the )?(payment|contract|invoice) (to|so as to) (avoid|stay under|keep under|reduce)\b/i,
  /\b(real|actual|true) price (is|will be) (agreed|settled|paid) (separately|privately|offline|outside)\b/i,
);

/** Paying a different person or account than the signed provider. */
export const IDENTITY_SWAP = g("IDENTITY_SWAP",
  new RegExp(String.raw`\b${PAY}\b.{0,30}\b(to|into) (a |an |my |our )?(different|another|other|third[- ]party|alternate|secondary|personal|relative'?s?|cousin'?s?|brother'?s?|sister'?s?|friend'?s?|partner'?s?|wife'?s?|husband'?s?) (account|person|party|wallet|pay ?pal( account)?|email|name)\b`, "i"),
  /\b(payee|recipient|beneficiary|receiving account|payout account) (may|can|will|shall) (be )?(change[ds]?|switch(ed)?|replace[ds]?|substitute[ds]?|updated) (at any time|later|without|by (email|message|phone|text|whatsapp))\b/i,
  /\b(change|switch|replace|update)s? (the )?(payee|recipient|beneficiary|receiving account|payout account|bank details|pay ?pal (account|email))\b.{0,30}\b(by|via|over) (email|message|phone|text|whatsapp|chat)\b/i,
  /\b(another|a different|any other|a third) (person|company|party|contractor|subcontractor) (may|can|will) (sign|approve|receive (the )?(payment|funds?|money))\b/i,
  /\b(may|can|is free to|shall be free to) (assign|transfer) (the |its |his |her |their )?(right to (payment|be paid|receive payment)|payments?|receivables?) to (any|another|a third)\b/i,
  new RegExp(String.raw`\bon behalf of (the )?${PARTY},? (pay|send|transfer|remit)\b`, "i"),
  new RegExp(String.raw`\b(pay|send|transfer|remit) (it |the money |the funds? )?to (the )?${PARTY}'?s? (agent|associate|nominee|representative|middleman)\b`, "i"),
  /\bnew (bank|payment|pay ?pal) details? (will be|shall be|are) (sent|provided|shared) (later|separately|by (email|message|phone|text))\b/i,
  /\b(pay|paid|payments?) (to|into) (the )?account (named|given|listed) (in|on|by) (the )?(invoice|email|message|chat|whatsapp)\b/i,
  /\b(sign|signs|signed|approve|approves) (on behalf of|for|as) (the )?(client|provider|other party) (without|instead of)\b/i,
);

/** Release without the agreed proof, review or approval (P4). */
export const EVIDENCE_WAIVER = g("EVIDENCE_WAIVER",
  /\b(no|without) (evidence|proof|photos?|documentation|sign[- ]?off|client approval) (is |are )?(needed|required|necessary)\b/i,
  /\b(evidence|proof|photos?|client approval|approval|sign[- ]?off) (is|are) (not (needed|required|necessary)|optional|waived)\b/i,
  /\b(waive|waives|waived|waiving|skip|skips|skipped|skipping) (the )?(evidence|proof|approval|acceptance) (step|requirement|check|process|period)?s?\b/i,
  new RegExp(NOT_NEGATED + String.raw`\b(release|pay|paid|payment)\w*\b.{0,30}\bwithout (the )?(client'?s? )?(approval|review|evidence|proof|inspection|sign[- ]?off|consent)\b`, "i"),
  /\b(deemed|treated as|considered) (approved|accepted|complete|completed|delivered) (immediately|on submission|upon submission|at submission|when (submitted|uploaded))\b/i,
  /\b(approval|acceptance) (is|will be|shall be) (automatic|immediate) (on|upon|at|after) (submission|upload|delivery claim)\b/i,
  new RegExp(String.raw`\b${PARTY}'?s? (word|statement|declaration|self[- ]?certification|say[- ]?so) (is|will be|shall be) (enough|sufficient|final|proof)\b`, "i"),
  /\b(client|buyer|customer|owner) (may not|cannot|can ?not|shall not|will not) (reject|refuse|query|question|inspect|review) (the )?(work|delivery|deliverables?|evidence|milestones?)?( for any reason| at all| under any circumstances|\.|$)/i,
  /\b(evidence|files?|photos?|uploads?) (may|can) be (edited|altered|changed|replaced|deleted) (after|once) (submission|upload|approval)\b/i,
  /\b(screenshots?|verbal|oral|phone) (confirmation|approval|sign[- ]?off) (is|are) (enough|sufficient|accepted) (for|to) (release|payment)\b/i,
);

/** Taking disputes away from the agreed sealed-offer / vault / mediator process. */
export const JURISDICTION_GAME = g("JURISDICTION_GAME",
  new RegExp(String.raw`\b(disputes?|claims?|disagreements?) (will|shall|must|are to) be (decided|resolved|settled|heard) (only |solely |exclusively )?by (the )?(${PARTY}|client|buyer)\b`, "i"),
  new RegExp(String.raw`\b(${PARTY}|client|buyer)'?s? decision (on|in|about) (any |all )?(disputes?|claims?|payments?|releases?|refunds?) (is|will be|shall be) final\b`, "i"),
  new RegExp(String.raw`\b(${PARTY}|client|buyer)'?s? decision (is|will be|shall be) final (in|on|for) (any |all )?(disputes?|claims?|payments?|refunds?)\b`, "i"),
  /\b(exclusive|sole) jurisdiction\b.{0,60}\b(instead of|rather than|not|override|replac)\w*\b.{0,30}\b(mediat|pay ?settle|pay ?pal|dispute process)/i,
  /\b(not|never) (use|go to|submit to|refer to|be referred to) (the )?(pay ?settle|pay ?pal|platform)('?s)? (dispute|mediation|resolution) (process|system|centre|center)\b/i,
  /\b(mediat(or|ion)|verdict|ruling|resolution)s? (is|are|will be|shall be) (not binding|non[- ]?binding|advisory only|ignored|optional)\b/i,
  /\b(instead of|rather than|in place of) (the )?(pay ?settle|pay ?pal|platform)('?s)? (dispute|mediation|resolution)\b/i,
  /\b(waive|waives|waived|waiving) (the )?(mediation|dispute (process|procedure|resolution)|sealed (offers?|bids?)|evidence vault)\b/i,
  /\b(any|all) (disputes?|claims?) (are|is) (time[- ]barred|barred|void) (after|unless raised within) \d{1,2} (hours?|minutes?)\b/i,
  /\b(opening|starting|filing) a (dispute|chargeback|claim) (incurs|carries|means|triggers) (a )?(penalty|fine|forfeit|fee of)\b/i,
);

/** Overriding system clauses, sealed verdicts or the platform rules generally. */
export const PROCESS_OVERRIDE = g("PROCESS_OVERRIDE",
  /\bignore (the )?(platform|system|pay ?settle|pay ?pal) (rules|clauses|terms|process)/i,
  /\b(this|the following) clause (overrides|supersedes|replaces|cancels|prevails over|takes precedence over) (all |any |the )?(system|platform|pay ?settle|other|standard) (clauses|rules|terms)\b/i,
  /\b(system|platform|pay ?settle|standard) (clauses|rules|terms) (do|does|shall|will) not apply\b/i,
  /\b(notwithstanding|regardless of|despite) (any|the) (system|platform|pay ?settle) (clause|clauses|rules|terms)\b/i,
  /\b(supersedes?|overrides?|cancels?|voids?|nullif(y|ies)|disapplies) (clause )?S[0-9]{1,2}\b/i,
  new RegExp(String.raw`\b(verdicts?|rulings?|decisions?) (of|by) (the )?(mediator|pay ?settle) (may|can|will) be (reversed|overturned|ignored|reopened) by (the )?(${PARTY}|client|buyer|either party)\b`, "i"),
  /\b(released|paid) (milestones?|money|funds?) (may|can|will|shall) be (clawed back|reclaimed|recalled|reversed) (by|at the request of) (the )?(client|buyer|provider|either party)\b/i,
  /\b(ai|the assistant|the model|chat ?gpt|the bot) (decides|approves|releases|controls|determines) (the )?(payment|release|refund|verdict|milestones?)\b/i,
  /\b(either party|the provider|the client) may (unilaterally (release|refund|move|withdraw)|(release|refund|move|withdraw) (the )?(held )?(funds|money|hold) (at any time|whenever|without))\b/i,
  /\b(hold|reserve)s? (the )?right to (release|withdraw|move) (the )?(held )?(funds|money|hold) (at any time|whenever|unilaterally)\b/i,
);

/** Changing price, scope or terms after signature without both signatures (P5, F2.10). */
export const SILENT_AMENDMENT = g("SILENT_AMENDMENT",
  /\b(price|total|amount|fee|scope|terms?|milestones?|contract) (may|can|will) (be )?(change[ds]?|increase[ds]?|adjust(ed)?|amend(ed)?|update[ds]?|modif(y|ied)) (at any time|at will|unilaterally|without (notice|consent|agreement|re-?signing|a new signature|signatures?))\b/i,
  /\b(verbal|oral|spoken|phone|whatsapp|text|chat|email) (agreements?|changes?|amendments?|instructions?) (override|supersede|replace|prevail over|amend|change) (this|the|any) (contract|agreement|written terms|clauses?)\b/i,
  new RegExp(String.raw`\b(${PARTY}|client) may unilaterally (change|amend|modify|rewrite|edit)\b`, "i"),
  new RegExp(String.raw`\b(${PARTY}|client) may (change|amend|modify|rewrite|edit) (this|the) (contract|agreement|terms|clauses?|milestones?|price|scope) (at any time|at will|without)\b`, "i"),
  /\b(without|no) (need (for|to)|requirement (for|to)) (re-?sign|re-?signing|a new signature|both signatures|counter-?signature)\b/i,
  /\b(changes?|amendments?) (are|is|will be|shall be) (binding|effective|valid) without (both|a|the other party'?s?|any|re-?) ?(signatures?|signing|consent|approval)\b/i,
  /\b(sealed|signed) (revision|version|contract|verdict) (may|can) be (edited|altered|changed|rewritten|deleted)\b/i,
  /\b(extra|additional|hidden) (charges?|fees?|costs?) (may|can|will) be (added|charged|applied) (at any time|later|without (notice|approval|agreement|consent))\b/i,
  new RegExp(String.raw`\bprices? (are|is) (subject to change|variable|indicative) (at|in) the (sole |absolute )?discretion of the ${PARTY}\b`, "i"),
  /\b(deadline|due date|delivery date)s? (may|can|will) be (moved|extended|pushed back|changed) (at will|unilaterally|at any time|without (notice|consent|agreement))\b/i,
  /\b(late|delay(ed)?) (delivery|completion) (is|will be|shall be) (deemed|treated as|considered) (on time|timely|complete)\b/i,
);

/** Every group, by trick (for the room's explanation and the test suite). */
export const CLAUSE_PATTERN_GROUPS: Record<ClauseTrick, ClausePattern[]> = {
  OFF_PLATFORM_PAYMENT, WAIVER_OF_RIGHTS, HOLD_BYPASS, RELEASE_ALL_NOW, REFUND_AFTER_SIGNATURE, FEE_AVOIDANCE,
  IDENTITY_SWAP, EVIDENCE_WAIVER, JURISDICTION_GAME, PROCESS_OVERRIDE, SILENT_AMENDMENT,
};

/** Phrases that try to negate system clauses (R07). Pattern list grows with mediator feedback (F4.12). */
export const CONTRADICTIONS: RegExp[] = Object.values(CLAUSE_PATTERN_GROUPS).flat();

/** Which tricks a clause body uses (empty when none). Same normalisation as policy.ts sees through ClausePattern.test. */
export function findContradictions(body: string): { trick: ClauseTrick; label: string; pattern: string }[] {
  const out: { trick: ClauseTrick; label: string; pattern: string }[] = [];
  for (const [trick, list] of Object.entries(CLAUSE_PATTERN_GROUPS) as [ClauseTrick, ClausePattern[]][]) {
    const hit = list.find((r) => r.test(body));
    if (hit) out.push({ trick, label: TRICK_LABELS[trick], pattern: hit.source });
  }
  return out;
}
