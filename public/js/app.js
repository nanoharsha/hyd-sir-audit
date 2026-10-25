import * as api from "./api.js";

let currentResults = [];
let currentUserEmail = null;
let currentUserName = null;
let isAdmin = false; // Team Coordinator or Super Admin
let isSuperAdmin = false;
let lang = localStorage.getItem("lang") || "en";
// True when the visitor is not signed in and we're showing the public
// progress view instead of the staff app. See showPublicHome() at the bottom.
let publicMode = false;

// Dashboard + PH Dashboard restricted to one person, owner request 2026-09-04.
// This is UI-only visibility (matches how Team/Monthly Pooling are hidden) —
// GET /api/dashboard and /api/reverify/dashboard are not role-gated server-side,
// same as every other read in this app; the tab is just not offered to anyone
// else. Not a PII boundary — see CLAUDE.md on what actually gates PII.
// Lower-case only: the comparison lower-cases the signed-in address before matching.
const DASHBOARD_RESTRICTED_TO = ["sreeharsha@hey.com", "akhil@safarindia.org"];

const I18N = {
  en: {
    title: "SIR Social Audit",
    sub: "", // tagline removed (owner request, 2026-10-08); .sub:empty collapses the line
    searchPlaceholder: "Enter House Number (e.g. 1053), EPIC ID (e.g. ZIP1897692), or Name (e.g. Sunita)",
    searchBtn: "Search",
    addBtn: "Addition",
    noMatches: "No matches.",
    verifyBtn: "Verify",
    verificationStatus: "Verification Status",
    verifiedBy: "Verified By",
    staffName: "Staff name",
    notes: "Notes",
    save: "Save",
    saved: "Saved.",
    savedOffline: "Saved on this device — will sync once you're back online.",
    subCategory: "Sub Category",
    form8Question: "Have you given Form 8 to the voter?",
    addNewIndividual: "Addition",
    houseNumber: "House Number",
    houseNumberPlaceholder: "e.g. 1053",
    partNumber: "Part Number",
    partNumberPlaceholder: "autofilled if house exists",
    name: "Name",
    epicId: "EPIC ID (leave blank if none)",
    relationType: "Relation Type",
    relationName: "Relation Name",
    additionCategory: "Category",
    contactPhone: "Phone Number",
    form6Given: "Form 6 Given",
    phoneRequiredHint: "A phone number is required for a wrongful deletion.",
    deletionType: "Type",
    optTypeDeath: "Death",
    optTypeAbsent: "Absent / Permanently shifted",
    optTypeDuplicateVoter: "Duplicate Voter",
    optTypeOther: "Other",
    correctionSubCategory: "Correction Sub-category",
    editDetails: "Edit details",
    downloadDatabase: "Full Database",
    age: "Age",
    gender: "Gender",
    saveIndividual: "Save Individual",
    cancel: "Cancel",
    added: "Added.",
    errorSaving: "Error saving.",
    optNotStarted: "Not Started",
    chooseStatus: "Choose Found or Not Found first.",
    chooseDeletionType: "Choose a deletion type.",
    chooseCorrectionType: "Choose a correction sub-category.",
    chooseAdditionCategory: "Choose a category.",
    optFound: "Found",
    optNotFound: "Not Found",
    optAllInfoCorrect: "All Information Correct",
    optDeletion: "Deletion",
    optCorrectionNeeded: "Correction needed",
    optMigrated: "Migrated",
    optOthers: "Others",
    // Addition categories (Form 6), correction sub-categories (Form 8) and
    // the roll's own flag tags. The stored values stay English; these are
    // display labels only.
    optCat18: "Completed 18 years",
    optCatMarriage: "Marriage",
    optCatWrongful: "Wrongful Deletion",
    optCatNotInBaseRoll: "Voter not found in base roll",
    optCatOther: "Other",
    optCorrEntries: "Correction of Entries in Existing Electoral Roll",
    optCorrShifting: "Shifting of Residence",
    flagAbsent: "Absent",
    flagExpired: "Expired",
    flagRepeated: "Repeated",
    flagShifted: "Shifted",
    // Capitalised because these now lead a "Father: NAME" line and fill the
    // relation dropdown; they no longer sit mid-sentence.
    optFather: "Father",
    optHusband: "Husband",
    optMother: "Mother",
    optMale: "Male",
    optFemale: "Female",
    optYes: "Yes",
    optNo: "No",
    optDash: "-",
    badgeFound: "Found",
    badgeNotFound: "Not Found",
    badgeNotStarted: "Not Started",
    badgeDupEpic: "Duplicate EPIC",
    badgeDeletedSource: "Deleted in source roll",
    badgeModifiedSource: "Modified in source roll",
    badgeSourceRollAddition: "Added in source roll update",
    badgeUnidentifiedDeletion: "Unidentified deletion",
    badgeS5Deleted: "Deleted in Supplement 5",
    badgeS5Added: "Addition in Supplement 5",
    badgeS5Correction: "Corrections in Supplement 5",
    badgeAddedField: "Added in field",
    badgeLocked: "Locked",
    badgePendingSync: "Not yet synced",
    yrs: "yrs",
    metaHouse: "House",
    metaEpic: "EPIC",
    metaPart: "Part",
    metaSrNo: "Sr. No.",
    metaVerifiedBy: "Verified by",
    metaAddedBy: "Added by",
    badgeAdditionType: "Addition",
    badgeDeletionType: "Deletion",
    badgeCorrectionType: "Correction",
    reopen: "Reopen",
    tabSearch: "Base Roll 2025",
    tabSearchAll: "SEARCH",
    saPlaceholder: "House number, EPIC number, or name",
    saIntro: "Search across the base roll, the Draft SIR 2026 roll and the ASDD list.",
    saOnAsddo: "ASDD",
    saPresentSir: "Present in SIR",
    saNoSir: "NO SIR",
    saFieldAddNoSir: "Field addition — not yet in SIR",
    saSrNo: "Sr. No.",
    saFieldVerif: "Field verification",
    saVerifiedBy: "Verified by",
    saRoundAsddo: "ASDD re-verification",
    saRoundDraftsir: "Draft SIR re-verification",
    saNotStarted: "Not started",
    saPhRemarks: "Public Hearing",
    saCaseId: "Case ID",
    saCaseIdHint: "Give this to the voter — it looks up their entire history.",
    saCaseIdPending: "Pending sync",
    saCaseIdPendingHint: "Saved on this device — the Case ID is assigned once it syncs online.",
    saCaseType: "Case Type",
    saCaseWrongAsdd: "Wrong ASDD Marking",
    saCaseNoSir: "No SIR",
    saCaseCorrection: "SIR Correction Request",
    saPickCaseType: "Choose a case type first.",
    saSaveCase: "Save Case",
    saSaved: "Saved.",
    saCaseRecordedBy: "Case recorded by",
    saSirSubmitted: "Did they submit the SIR enumeration form to the BLO?",
    saSirMode: "How was it submitted?",
    saOnline: "Online",
    saOffline: "Offline",
    saSirReceipt: "Do they have a receipt of the submission?",
    saCorrectionFields: "What needs to be corrected?",
    saFieldName: "Name",
    saFieldAddress: "Address",
    saFieldAge: "Age",
    saFieldSex: "Sex",
    saFieldRelName: "Relative Name",
    saFieldRelType: "Relative Type",
    saFieldOther: "Other",
    saOtherSpecify: "Specify",
    saParticipation: "Public Hearing Participation",
    saPartTestimony: "Testimony",
    saPartSupport: "Support / Assistance",
    saPartOther: "Other",
    saPickParticipation: "Choose a participation type first.",
    saPhone: "Phone / Contact Number",
    saPhonePlaceholder: "10-digit mobile number",
    saPhoneInvalid: "Enter a valid 10-digit contact number.",
    saIssueDescription: "Description of the Issue",
    saSupportType: "How will they be supported?",
    saSupportForm6Self: "Form 6 - Self Filling",
    saSupportForm6Assisted: "Form 6 - Assisted",
    saSupportOther: "Other",
    saRemarks: "Remarks",
    saFollowUp: "Follow-up (anyone can add this)",
    saKnowsBlo: "Do they know who their BLO is and have their contact details?",
    saBloUnknown: "No BLO contact on file for this part.",
    saBloBoothOld: "Old Booth No.",
    saBloBoothNew: "New Booth No.",
    saBloName: "BLO Name",
    saBloPhone: "BLO Ph. No.",
    saBroughtToBlo: "Has this been brought to the BLO's attention?",
    saOtherRemarks: "Other Remarks",
    saPhoneConfirmNote: "Confirm this is the correct contact number before saving:",
    saSaveFollowUp: "Save Follow-up",
    saFollowUpRecordedBy: "Follow-up recorded by",
    tabDashboard: "Dashboard",
    dashBaseTotal: "Base Roll Total",
    dashCompleted: "Verification Completed",
    dashPending: "Pending",
    dashAdditions: "Additions",
    dashDeletions: "Deletions",
    dashCorrections: "Corrections",
    dashNotFoundShifted: "Not Found – Shifted",
    dashRevisedTotal: "Revised Total",
    dashRevisedFormula: "Found on base roll + Additions − Deletions",
    dashPercent: "% Complete",
    partsTitle: "Coverage by Part",
    partCol: "Part",
    partColBase: "Base Roll",
    partColDone: "Done",
    partColAdditions: "Additions",
    partColDeletions: "Deletions",
    partColCorrections: "Corrections",
    viewList: "View list →",
    dashProgressTitle: "Verification Progress",
    dashFound: "Found",
    dashNotFound: "Not Found",
    drillShowing: "Showing",
    drillClear: "Clear",
    drillUniqueVoters: "unique voters",
    partsFootnote:
      "Part totals count roll entries. A few voters are enrolled in two parts (and Supplement 5 part-moves keep both entries), so the parts sum to more than the unique-voter Base Roll Total above.",
    drillSummary: "By type",
    notSpecified: "Not specified",
    mySummaryTitle: "My Activity",
    mySummaryVerifications: "Verifications",
    mySummaryAdditions: "Additions",
    mySummaryDeletions: "Deletions",
    mySummaryCorrections: "Corrections",
    dailyActivityTitle: "Daily Activity",
    dailyActivityDate: "Date",
    dailyActivityStaff: "Staff",
    dailyActivityVerifications: "Verifications",
    dailyActivityAdditions: "Additions",
    dailyActivityDeletions: "Deletions",
    dailyActivityCorrections: "Corrections",
    dailyActivityTotal: "Total",
    dailyActivityEmpty: "No activity recorded for this date.",
    tabTeam: "Team",
    tabSourceUpdate: "Additions (Feb 2025 - June 2026)",
    tabUnidentifiedDeletions: "Unidentified Deletions (Feb 2025 - June 2026)",
    tabMonthlyPooling: "Monthly Pooling (Feb 2025 - June 2026)",
    tabAsddo: "ASDD List",
    tabDraftsir: "Draft SIR 2026",
    tabReverify: "PH Dashboard",
    rvTitle: "PH Dashboard",
    rvUpdated: "Updated",
    rvDoubleCheck: "double-check",
    rvDone: "done",
    rvReverified: "re-verified",
    rvLeft: "left",
    rvSettled: "settled",
    rvRefuted: "refuted",
    rvOther: "other",
    rvBaseChanges: "base-roll changes",
    rvAllTiles: "All tiles",
    rvVdConfirmed: "Confirmed",
    rvVdRefuted: "Refuted",
    rvVdOther: "Other",
    rvVdPending: "Pending",
    rvBy: "by",
    rvWas: "was",
    rvNow: "now",
    rvChangedSince: "Base roll changed since the snapshot",
    rvNewCandidates: "Not in the tile yet — base roll now qualifies them",
    rvNoRows: "No rows.",
    rvNoneDone: "Nothing re-verified in this tile yet.",
    rvPendingNote: "still to re-verify (worked from the ASDD List / Draft SIR tab)",
    monthlyPoolingSource:
      'Source: Summary of Additions, Deletions and Modification, Chief Electoral Officer, Telangana.',
    loading: "Loading…",
    statusOfflineShort: "offline",
    // -- generic reverification-list tab (worklist-tab.js) --
    wlLoading: "Loading…",
    wlSearchBtn: "Search",
    wlBack: "Back",
    wlSearchPlaceholder: "House number, EPIC ID, or Name",
    wlOffline: "Offline",
    wlOfflineShort: "offline",
    wlAllTiles: "All tiles",
    wlAnomaliesTitle: "Anomalies",
    wlInHouses: "in {n} houses",
    wlDone: "reverified",
    wlDoubleCheck: "to double-check",
    wlVoters: "voters",
    wlHouses: "houses",
    wlVoterWord: "voter",
    wlHouseWord: "house",
    wlPart: "Part",
    wlNewPart: "New part",
    wlHouse: "House",
    wlSegConfirmed: "Confirmed — go re-confirm",
    wlSegDoubleCheck: "Double-check first",
    wlDc: "double-check",
    wlWeFound: "We found",
    wlWhy: "Flag",
    wlOurNote: "our note",
    wlPrevBy: "Verified earlier by",
    wlReverified: "Reverified:",
    wlResults: "results",
    wlNoResults: "Nobody on this list matches that.",
    okTitle: "Secunderabad Cantt — household status",
    okQNoticeRecv: "Has the elector received the physical copy of the notice?",
    okQHearing: "Status of the hearing",
    okHrCompleted: "Completed",
    okHrDue: "Due",
    okHrNotKnown: "Not known",
    okQDocs: "Has the elector submitted the required documents to the BLO?",
    okDocUnaware: "Unaware of what documents to give",
    okQDelStatus: "Field status of the deletion",
    okDelWrongful: "Wrongful deletion",
    okDelValid: "Valid deletion",
    okQDelAware: "Is the elector aware of the reason for the deletion?",
    okQDelGot: "Did the elector receive the SIR enumeration form?",
    okQDelSubmitted: "Did they submit the SIR enumeration form to the BLO?",
    okErrNoticeRecv: "Please say whether the elector has received the physical copy of the notice.",
    okErrHearing: "Please choose the status of the hearing.",
    okErrDocs: "Please say whether the required documents were submitted to the BLO.",
    okErrDelStatus: "Please choose the field status: wrongful or valid deletion.",
    okErrDelAware: "Please say whether the elector is aware of the reason for the deletion.",
    okErrDelGot: "Please say whether the elector received the SIR enumeration form.",
    okErrDelSub: "Please say whether the enumeration form was submitted to the BLO.",
    okNoticeWhy: "Why the notice was issued",
    okNoticeCount: "{n} reasons",
    okNrBlankLabel: "No reason printed",
    okNrParentName: "The parent's name on the roll does not match the linked earlier record.",
    okNrSelfName: "The voter's own name on the roll does not match the linked earlier record.",
    okNrUnmapped: "The voter could not be linked to the 2002 roll.",
    okNrProgeny6: "Six or more children are linked to the same parent.",
    okNrProgenyGap: "Two children linked to the same parent are less than 9 months apart in age.",
    okNrParentLt15: "The parent is less than 15 years older than the voter.",
    okNrParentGt50: "The parent is more than 50 years older than the voter.",
    okNrGrandLt40: "The grandparent is less than 40 years older than the voter.",
    okNrParentIneligible: "The parent was marked ineligible in the last SIR.",
    okNrBlank: "The notice list does not print a reason for this voter — ask the BLO.",
    okVerifyBtn: "Verify visit",
    okEditVisit: "Edit visit",
    okVerified: "Visit recorded",
    okYes: "Yes",
    okNo: "No",
    okUnable: "Unable to verify",
    okQCorrect: "Is the ASDD marking correct?",
    okQWrong: "What is wrong with the ASDD marking?",
    okChoose: "Choose…",
    okWrShifted: "Wrongly marked as shifted",
    okWrDead: "Wrongly marked as dead",
    okWrAbsent: "Wrongly marked as absent",
    okWrDup: "Wrongly marked as duplicate",
    okQEnum: "Was the Enumeration Form submitted?",
    okEnYes: "Yes",
    okEnNotRecv: "Not received from BLO",
    okEnNotGen: "Form not generated",
    okEnNotColl: "Uncollected form found with elector",
    okEnOther: "Other",
    okQForm6: "Has the voter submitted Form 6 to the BLO now?",
    okQAssist: "Does the voter need assistance with Form 6?",
    okQGiven: "Form 6 given and guidance explained?",
    okGuideHd: "Give the voter Form 6 and walk them through it:",
    okGuide1: "Hand over a blank Form 6 (the BLO has copies; it can also be filed online at voters.eci.gov.in or in the Voter Helpline app).",
    okGuide2: "Name, relative's name, date of birth and gender: copy them exactly as printed on the voter's ID card or other proof.",
    okGuide3: "Present address: house number, locality and part. If the voter lived elsewhere before, write that address as well.",
    okGuide4: "Previous enrolment: write the old EPIC number {epic} and the old part {part}.",
    okGuide5: "Attach proof of age and proof of address (for example Aadhaar, birth or school certificate, ration card or a utility bill) and a recent photograph.",
    okGuide6: "Sign the declaration and give the form to the BLO. Ask for the acknowledgement and photograph it.",
    okGuide7: "Claims from voters left out of the draft roll are open until 30 October 2026. For help call the voter helpline 1950.",
    okQPhone: "Voter's phone number",
    okQPhoneOpt: "Voter's phone number (optional)",
    okErrPhoneOpt: "The phone number must be 10 digits — or leave it empty.",
    okPhoneHint: "10-digit mobile number",
    okQRemarks: "Remarks",
    okQRemarksReq: "Remarks (required because “Other” was chosen)",
    okSave: "Save visit",
    okSaving: "Saving…",
    okCancel: "Cancel",
    okSavedToast: "Visit saved",
    okErrCorrect: "Please say whether the ASDD marking is correct.",
    okErrWrong: "Please choose how the ASDD marking is wrong.",
    okErrEnum: "Please say whether the Enumeration Form was submitted.",
    okErrRemarks: "Please explain “Other” in the remarks.",
    okErrForm6: "Please say whether Form 6 has been submitted.",
    okErrAssist: "Please say whether the voter needs assistance with Form 6.",
    okErrGiven: "Please say whether Form 6 was given and the guidance explained.",
    okErrPhone: "A 10-digit phone number is required.",
    okErrEmptyVisit: "Please fill in at least one answer before saving.",
    okErrOffline: "No connection — the visit was not saved. Try again when you are online.",
    okErrSave: "Could not save. Please try again.",
    okBaseTotal: "Base roll total (2025 roll + monthly changes)",
    okBaseSub: "{roll} in the 2025 roll + {add} added − {del} deleted in the monthly lists",
    okDraftTotal: "Included in the Draft SIR 2026",
    okDraftSub: "{roll} from the 2025 roll + {add} added since",
    okAddedSince: "Added since Jan 2025",
    okAddedMonth: "Added {m}",
    okNamePartial: "Name incomplete (first 10 letters)",
    okEpicPrefix: "No exact EPIC — showing EPICs that start with that.",
    okAuditScope: "2025 parts {range}",
    okFromHH: "from household",
    okEnNotColl2: "Form not collected from the BLO",
    okEnFound: "Enumeration form found with the elector",
    okDocYesSir: "Yes — a document from the SIR list",
    okDocYesOther: "Yes — but not from the SIR list",
    okQCorrections: "Does this voter's entry need any correction?",
    okCorNone: "Nothing needs correcting",
    okCorName: "Name",
    okCorDob: "Date of birth / age",
    okCorGender: "Gender",
    okCorPhoto: "Photo",
    okCorRelName: "Relative's name",
    okCorRelType: "Relation type",
    okCorAddress: "Address",
    okQForm8: "Has the voter submitted Form 8?",
    okForm8Hint: "Form 8 corrects an existing entry. Help them file it if you can, and note what is wrong in the remarks.",
    okQHasId: "Does the elector have a hard copy or photo of their Voter ID?",
    okQEpicText: "Voter ID number (if they can give it)",
    okQLastVoted: "When did they last vote?",
    okLastVotedHint: "e.g. 2023 assembly, never",
    okQForm6Mode: "Has the voter submitted Form 6?",
    okF6Online: "Yes — online",
    okF6Offline: "Yes — on paper",
    okF6Both: "Yes — both",
    okQAckNo: "Acknowledgement number (if they have it)",
    okSamePhone: "Use {phone} (same household)",
    okQDocsUpload: "Photos or documents (up to {n})",
    okDocCamera: "Take a photo",
    okDocFile: "Attach a file",
    okDocRemove: "Remove",
    okDocFull: "{n} attached — remove one to add another",
    okDocFailed: "That file could not be read. Try photographing it instead.",
    okF6ReqHd: "What a Form 6 needs",
    okF6Req1: "A clear passport-size photo",
    okF6Req2: "Aadhaar card",
    okF6Req3: "Self-attested ID proof (avoid Aadhaar if possible)",
    okF6Req4: "Self-attested address proof (avoid Aadhaar if possible)",
    okF6Req5: "Voter ID of a relative at the same address, as a reference",
    okF6Req6: "Post office name",
    okF6Req7: "SIR 2002 details — their own or a parent's",
    okF6Req8: "For an online application, a mobile number",
    okReasonAll: "All reasons",
    okReasonFilter: "Reason",
    okFocusScope: "2026 booths {booths} — the booths being canvassed",
    okPartWord: "Part",
    okBoothWord: "Booth",
    okSNotice: "Notice",
    okSAsdd: "ASDD",
    okSDeleted: "Deleted",
    okTileDeleted: "Pre-SIR deletion",
    okSCleared: "SIR Cleared",
    okSNoSir: "Not in SIR",
    okSPending: "Draft awaited",
    okSUnlinked: "No EPIC",
    okAllParts: "All parts",
    okCritical: "Critical parts",
    okOtherParts: "Other parts",
    okSClearedAssumed: "Cleared (assumed)",
    okSearchPlaceholder: "House number, EPIC or name",
    okClear: "Clear",
    okPartHint: "House numbers repeat across booths — pick one to narrow a house search. Numbers are shown as 2026 booth and 2025 part, because the roll was renumbered.",
    okOldPart: "2025 part",
    okNewPart: "2026 booth",
    okEst: "est.",
    okFloor: "floor",
    okSupplement: "Added in Jan-2025 supplement",
    okNoEpic: "No EPIC",
    okAltEpic: "also EPIC",
    okHouse: "House",
    okNoHouse: "House number not recorded",
    okNoBlock: "No block recorded",
    okMember1: "1 elector",
    okMembers: "{n} electors",
    okRestored: "Your unsaved entry for this elector was restored.",
    okQueuedToast: "No connection — your entry is kept on this phone and will be sent automatically.",
    okWaiting: "Waiting to send — kept on this phone",
    okBannerWaiting: "{n} waiting to send. They go automatically when the phone is online.",
    okBannerRejected: "{n} could not be saved:",
    okBannerDrafts: "{n} typed but not saved yet:",
    okSendNow: "Send now",
    okOpen: "Open",
    okSentToast: "{n} waiting entries were saved.",
    okMergedToast: "Saved. {name} had already saved this visit — the answers were combined.",
    okMergedChanged: " ({n} answers changed)",
    okSomeoneElse: "Someone else",
    okTabSearch: "Search",
    okTabProgress: "Progress",
    okTabHearing: "Public Hearing",
    okTabHearingDash: "Hearing dashboard",
    phDashTitle: "Public hearing",
    phDashAt: "as of",
    phDashRefresh: "Refresh",
    phDashTotal: "Tokens generated",
    phDashOther: "Other",
    phDashByCounter: "By counter",
    phDashCounter: "Counter",
    phDashTokens: "Tokens",
    phDashExit: "Exit desk",
    phDashExitDone: "Exit desk recorded",
    phDashTestYes: "Gave testimony: yes",
    phDashTestNo: "Gave testimony: no",
    phDashIssuers: "Tokens issued by",
    phDashVolunteer: "Volunteer",
    okTwinHd: "Possible duplicate entry",
    okTwinSub: "Same name, age, gender and house, listed under another EPIC. Both entries and their status:",
    okChgHd: "Changed since the 2025 roll",
    okChgName: "Name",
    okChgAge: "Age",
    okChgGender: "Gender",
    okChgRel: "Relative",
    okChgHouse: "House",
    okChgMonthly: "Modified in monthly lists:",
    phPlaceholder: "EPIC number or house number",
    phHint: "Find the elector who has come to the hearing, then press Public Hearing next to their name.",
    phIdle: "Type an EPIC number or a house number to find the elector.",
    phBtn: "PUBLIC HEARING",
    phFormTitle: "Public hearing token",
    phLName: "Name",
    phLRelative: "Relative",
    phLAgeSex: "Age / sex",
    phLEpic: "EPIC number",
    phLHouse: "House",
    phLParts: "Part",
    phLBlock: "Block",
    phLStatus: "SIR status",
    phBlockNone: "Not mapped to a block (token will be PH-MISC)",
    phPhone: "Phone number (optional)",
    phPhoneHint: "10-digit mobile number",
    phIssue: "Issue token",
    phIssuing: "Issuing…",
    phNoPhoneConfirm: "No phone number was entered. Issue the token without one?",
    phErrIssue: "Could not issue the token. Please try again.",
    phOffline: "Tokens need a connection. Try again when you are online.",
    phTokenTitle: "Token number",
    phCounter: "Go to counter",
    phTellThem: "Tell the elector their token number",
    phExisting: "This elector already had a token. It is shown again.",
    phDone: "Done",
    phExitBtn: "EXIT DESK",
    phLToken: "Token",
    phPhoneShort: "Phone number",
    phExitTitle: "Exit desk",
    phQTestimony: "Testimony at public hearing",
    phYes: "Yes",
    phNo: "No",
    phQStatus: "Public hearing status (select all that apply)",
    phS1: "Form 6 + Self-Declaration filled",
    phS2: "Form 6 + Self-Declaration submitted to BLO",
    phS3: "Received acknowledgement receipt from BLO",
    phS4: "Assistance regarding notice provided",
    phS5: "First-time voter Form 6 filled",
    phQRemarks: "Remarks",
    phExitSave: "Save exit details",
    phExitSaved: "Exit details saved",
    phExitNeedAny: "Fill in at least one answer.",
    phExitRecorded: "Exit desk recorded",
    phExitSavedBy: "Last saved by",
    okAllInScope: "Everything on the dashboard",
    okRefresh: "Refresh",
    okUpdated: "Updated",
    okProgCovered: "How much is covered",
    okElectorsCovered: "Electors covered",
    okHousesCovered: "Houses fully covered",
    okDone: "done",
    okLeft: "left",
    okHousesPartly: "partly covered",
    okHousesNotStarted: "not started",
    okVisitsToday: "Visits today",
    okVisitsTodaySub: "saved since midnight",
    okProgFound: "What the visits are finding",
    okOfAsddVisits: "out of {n} ASDD visits ({p}%)",
    okOfDelVisits: "out of {n} deletion visits",
    okOffNow: "Offline",
    okOffReady: "Offline copy on this phone: {n} electors, updated {when}",
    okOffFirst: "Downloading the offline copy of parts 59–69 when the connection allows…",
    okOffNone: "No offline copy on this phone yet — connect once to download it",
    okOffDownloading: "Downloading offline copy… part {i} of {n}",
    okOffUpdate: "Update offline copy",
    okOffSyncFail: "Could not update the offline copy — try again with a better connection",
    okOffNoCopy: "No connection, and no offline copy is saved on this phone yet. Connect once to download it.",
    okOffResults: "Searching the copy saved on this phone (parts 59–69 only). New entries are sent automatically when you are back online.",
    okOfNoticeVisits: "out of {n} notice visits ({p}%) · hearing and documents still pending",
    okProgVolunteers: "Volunteers",
    okVolunteer: "Volunteer",
    okToday: "Today",
    okTotal: "Total",
    okNoVisitsYet: "No visits saved yet.",
    okProgByPart: "By booth",
    okHousesTouched: "Houses visited",
    okBackToProgress: "Back to progress",
    okListCount: "{e} electors in {h} houses",
    okKElectorsDone: "Electors covered",
    okKElectorsLeft: "Electors left to visit",
    okKAsddDone: "ASDD visited",
    okKAsddLeft: "ASDD left to visit",
    okKNoticeDone: "Notice visited",
    okKNoticeLeft: "Notice left to visit",
    okKDeletedDone: "Pre-SIR deletion visited",
    okKDeletedLeft: "Pre-SIR deletion left to visit",
    okKAsddWrong: "ASDD marked wrong",
    okKAsddRight: "ASDD marking correct",
    okKAsddUnable: "ASDD unable to verify",
    okKNoticeNotRecv: "Notice not received",
    okKNoticeUnable: "Notice unable to verify",
    okKHearingDue: "Hearing due",
    okKDocsNo: "Documents not submitted",
    okKWrongful: "Wrongful pre-SIR deletion",
    okKTotalCases: "Total cases",
    okTotalCasesSub: "ASDD marked wrong + wrongful pre-SIR deletion",
    okKToday: "Visits today",
    okKHousesDone: "Houses fully covered",
    okKHousesPartial: "Houses partly covered",
    okKHousesNone: "Houses not started",
    okKHousesAll: "All houses",
    okBlockWord: "Block",
    okAllBlocks: "All blocks",
    okPrev: "Previous",
    okNext: "Next",
    okPage: "Page {a} of {b}",
    okPartsWith: "Parts with “{s}” electors — tap one to open it",
    okIdle: "Pick a booth, or search any elector in Secunderabad Cantt by EPIC, name or house number. Tap a count above to see which booths have them.",
    okNoResults: "No electors match that.",
    okNeedPart: "This house number exists in several parts — choose a part to narrow it down.",
    okLetterHouse: "Also showing the same number written with a block letter, and its sub-houses (for example F50 and F50/A for “50”).",
    okPrefixHouse: "No exact house — showing houses that start with that number.",
    okTruncated: "Showing the first {n} matches — pick a part or type more to narrow it.",
    okHouseholdsCount: "{n} households",
    okDelRoll: "Struck off in the Jan-2025 roll: {r}",
    okDelMonthly: "Removed in the {m} monthly deletion list (reason not published)",
    wlOnWorklist: "on the worklist",
    wlFlaggedFor: "Flagged for reverification",
    wlNoReverifyNeeded: "No reverification flagged",
    wlOtherFlags: "other flags",
    wlOtherFlagsTitle: "Other flags at this house \u2014 record here if you meet them",
    wlEdit: "Edit reverification",
    wlVerifyBtn: "Reverify",
    wlOutcomeLabel: "What did you find on the revisit?",
    wlNotesLabel: "Notes",
    wlRemarkLabel: "Remark (required)",
    wlNeedRemark: "Write a remark to save this as “Other”.",
    wlSaveBtn: "Save reverification",
    wlCancel: "Cancel",
    wlPickOutcome: "Choose what you found.",
    wlErrSaving: "Error saving.",
    wlSaved: "Saved.",
    wlPhotoAttached: "Photo attached.",
    wlAddPhoto: "Add photo",
    wlRemove: "Remove",
    wlSirLabel: "Did they submit the SIR enumeration form to the BLO?",
    wlSirYes: "Yes",
    wlSirNo: "No",
    wlSirOnline: "Submitted online",
    wlVotedLabel: "Did they vote in the 2023 Telangana Assembly election?",
    wlJanLabel: "Camp cum Jan Sunwai — will they take part?",
    wlJanParticipate: "Will participate",
    wlJanSpeak: "Will speak",
    wlJanNo: "No",
    wlYes: "Yes",
    wlNo: "No",
    wlPhoneLabel: "Phone number",
    wlPhotoLabel: "Photo",
    wlOutAlive: "Alive — found at the address",
    wlOutDead: "Dead — confirmed",
    wlOutPresent: "Present at the address",
    wlOutShifted: "Permanently shifted / migrated",
    wlOutAbsent: "Absent — not present",
    wlOutNoDup: "No duplicity found",
    wlOutDup: "Duplicate — confirmed",
    wlOutFound: "Found at the address",
    wlOutNotFound: "Not found",
    wlOutFoundPresent: "Found and present at the address",
    wlOutOther: "Other — just leave a remark",
    // -- PH FOLLOW UP --
    tabPhFollowup: "PH FOLLOW UP",
    phfTitle: "Follow-up of the Public Hearing Cases",
    phfSearchPlaceholder: "House number, EPIC ID, or Name — any voter, not only Public Hearing cases",
    phfCasesEmpty: "No Public Hearing cases recorded yet.",
    phfCaseWord: "case",
    phfCases: "cases",
    phfClosedWord: "closed",
    phfCaseTag: "Public Hearing case",
    phfNoCaseTag: "No Public Hearing case on file",
    phfQ1: "Has the BLO contacted you?",
    phfQ2: "Have you submitted your Form 6?",
    phfQ3: "Do you need assistance submitting Form 6?",
    phfQ4: "Have you received a notice?",
    phfClosedTag: "Form 6 submitted — closed",
    phfFollowUpBtn: "Follow Up",
    phfEditBtn: "Edit follow-up",
    phfSaveBtn: "Save follow-up",
    phfSaved: "Follow-up saved.",
    phfErrSaving: "Error saving. Try again.",
    phfNoResults: "No voter matches that.",
    phfUpdatedBy: "Last updated by",
    phfSelectPart: "Select Part",
    phfSelectHouse: "Select House",
    phfChoose: "— Choose —",
    phfGovLabel: "PH Status",
    phGovInDraft: "In Draft SIR roll",
    phGovNoSir: "NO SIR (DROPPED)",
    phGovFieldAddition: "Field addition — not on any list",
    phfTileHouseholdsLabel: "Households",
    phfTileCasesLabel: "Cases (Individuals)",
    phfTileBloLabel: "BLO Contacted",
    phfTileForm6Label: "Form 6 Submitted",
    phfTileAssistLabel: "Need Assistance with Form 6",
    phfTileNoticeLabel: "Notice Received",
    phfCompletedWord: "completed",
    phfFilteredBy: "Filtered by",
    phfNoHouseholds: "No households match this filter.",
    phfTilesTitle: "Follow-up Progress",
    phfCompletedByPartTitle: "Completed Cases, by Part",
    phfHideCompleted: "Hide",
    phfNotesLabel: "Notes / Remarks",
    phfNotesPlaceholder: "Anything else worth recording about this visit",
    // -- ASDD List --
    asddoTileDead: "Marked DEAD in ASDD — verified alive",
    asddoTilePshift: "Marked PERMANENTLY SHIFTED — present at the address",
    asddoTileAbsent: "Marked ABSENT / UNTRACEABLE — present at the address",
    asddoTileEnrolled: "Marked DUPLICATE — present, no duplicity found",
    asddoTileNotbase: "In the ASDD List, not in our base roll",
    asddoListSays: "ASDD says",
    asddoMovedLabel: "Were they a voter elsewhere and recently moved here?",
    asddoReasonDeath: "Death",
    asddoReasonShifted: "Permanently Shifted",
    asddoReasonAbsent: "Untraceable / Absent",
    asddoReasonEnrolled: "Already enrolled",
    // -- Draft SIR 2026 --
    draftsirTileDead: "Marked DEAD by us — but in the Draft SIR roll",
    draftsirTileNotBase: "In the Draft SIR roll — not in our base roll",
    draftsirTileVerified: "Verified present — not on the Draft or ASDD list",
    draftsirTilePending: "In the base roll, not yet verified — not on the Draft or ASDD list",
    draftsirTileAddition: "Field addition — not on the Draft or ASDD list",
    draftsirInRoll: "In the published Draft SIR roll",
    draftsirNotInRoll: "Not in the published Draft SIR roll",
    draftsirMovedLabel: "Were they a voter elsewhere and recently moved here?",
    xlsx: "Excel",
    liveBannerText: "New updates available — tap to refresh",
    unknownUser: "Unidentified user",
    deathCertPhoto: "Death certificate photo",
    takePhoto: "Add photo",
    removePhoto: "Remove photo",
    photoUploaded: "Photo attached.",
    teamTitle: "Team",
    teamName: "Name",
    teamEmail: "Email",
    teamCoordinator: "Role",
    teamLastActive: "Last Active",
    teamMakeAdmin: "Make Team Coordinator",
    teamRemoveAdmin: "Remove Team Coordinator",
    resetAllTitle: "Erase all fieldwork",
    resetAllWarning:
      "This returns every record to untouched and deletes all work recorded in the field. It cannot tell test entries from real ones, and it cannot be undone. Take a database backup first.",
    resetAllVerifications: "Verifications to be cleared",
    resetAllAdditions: "Field additions to be deleted",
    resetAllRevisits: "Revisit flags to be deleted",
    resetAllHistory: "History entries to be deleted",
    resetAllPhotos: "Death certificate photos to be deleted",
    resetAllKeeps: (n) => `The imported roll of ${n} electors is not affected.`,
    resetAllTypeToConfirm: (phrase) => `Type ${phrase} to confirm`,
    resetAllButton: "Erase all fieldwork",
    resetAllNothing: "There is no recorded fieldwork to erase.",
    resetAllDone: (n) => `Erased. ${n} records returned to untouched.`,
    teamAddCoordinator: "Add Team Coordinator by email",
    teamAddBtn: "Add",
    roleSuperAdmin: "Super Admin",
    roleCoordinator: "Team Coordinator",
    deleteEntry: "Delete entry",
    deleteEntryConfirmAddition:
      "Delete this entry? It was added in the field and has no existence on the original roll, so it will be removed completely, along with its history. This cannot be undone.",
    deleteEntryConfirmBaseRoll:
      "This voter is on the original electoral roll and cannot be deleted outright. This will reset their verification back to Not Started, clearing any notes, category, or photo already recorded. This cannot be undone. Continue?",
    nameModalTitle: "Before you continue",
    nameModalBody:
      "Every verification, addition, and deletion in this app is attributed to a name, so the team can tell who did what. Enter the name your coordinator knows you by.",
    nameModalLabel: "Your name",
    nameModalPlaceholder: "e.g. Priya Sharma",
    nameModalRequired: "Enter your name to continue.",
    nameModalSubmit: "Continue",
    logout: "Log out",
    exportsTitle: "Downloads",
    exportFull: "Full Roll",
    exportAdditions: "Additions",
    exportDeletions: "Deletions",
    exportCorrections: "Corrections",
    exportNotFound: "Not Found",
    csv: "CSV",
    zip: "ZIP (by part)",
    statusOffline: "Offline",
    statusSyncing: "Syncing…",
    statusPending: (n) => `${n} pending`,
    searchNoteHouse: (n, base) => `${n} record${n === 1 ? "" : "s"} at house ${base}.`,
    searchNoteEpic: (n, base) => `${n} record${n === 1 ? "" : "s"} for EPIC number ${base}.`,
    searchNoteName: (n, q) => `${n} record${n === 1 ? "" : "s"} matching the name ${q}, closest matches first.`,
    searchNoteRelation: (n, q) =>
      `No voter is named ${q}. Showing ${n} voter${n === 1 ? "" : "s"} whose father, husband or mother has that name.`,
    searchNoteLoose: (n, q) =>
      `Nothing matched ${q} exactly. Showing ${n} approximate match${n === 1 ? "" : "es"} on house number or name — check carefully.`,
    searchNoteOfflineSuffix: " (from this device's offline copy)",
  },
  hi: {
    title: "SIR सोशल ऑडिट",
    sub: "",
    searchPlaceholder: "मकान नंबर (जैसे 1053), EPIC ID (जैसे ZIP1897692), या नाम (जैसे सुनीता) दर्ज करें",
    searchBtn: "खोजें",
    addBtn: "जोड़ें",
    noMatches: "कोई परिणाम नहीं मिला।",
    verifyBtn: "सत्यापित करें",
    verificationStatus: "सत्यापन स्थिति",
    verifiedBy: "सत्यापनकर्ता",
    staffName: "कर्मचारी का नाम",
    notes: "टिप्पणी",
    save: "सेव करें",
    saved: "सेव हो गया।",
    savedOffline: "इस डिवाइस पर सेव हुआ — ऑनलाइन होते ही सिंक होगा।",
    subCategory: "उप-श्रेणी",
    form8Question: "क्या मतदाता को फॉर्म 8 दिया गया है?",
    addNewIndividual: "जोड़ें",
    houseNumber: "मकान नंबर",
    houseNumberPlaceholder: "जैसे 1053",
    partNumber: "भाग संख्या",
    partNumberPlaceholder: "मकान मौजूद होने पर अपने आप भर जाएगा",
    name: "नाम",
    epicId: "EPIC ID (न होने पर खाली छोड़ें)",
    relationType: "संबंध प्रकार",
    relationName: "संबंधी का नाम",
    additionCategory: "श्रेणी",
    contactPhone: "फ़ोन नंबर",
    form6Given: "फॉर्म 6 दिया गया",
    phoneRequiredHint: "गलत तरीके से हटाए जाने के लिए फ़ोन नंबर आवश्यक है।",
    deletionType: "प्रकार",
    optTypeDeath: "मृत्यु",
    optTypeAbsent: "अनुपस्थित / स्थायी रूप से स्थानांतरित",
    optTypeDuplicateVoter: "डुप्लीकेट वोटर",
    optTypeOther: "अन्य",
    correctionSubCategory: "सुधार उप-श्रेणी",
    editDetails: "विवरण संपादित करें",
    downloadDatabase: "पूरा डेटाबेस",
    age: "आयु",
    gender: "लिंग",
    saveIndividual: "व्यक्ति सेव करें",
    cancel: "रद्द करें",
    added: "जोड़ा गया।",
    errorSaving: "सेव करने में त्रुटि।",
    optNotStarted: "शुरू नहीं हुआ",
    chooseStatus: "पहले मिला या नहीं मिला चुनें।",
    chooseDeletionType: "हटाने का प्रकार चुनें।",
    chooseCorrectionType: "सुधार उप-श्रेणी चुनें।",
    chooseAdditionCategory: "एक श्रेणी चुनें।",
    optFound: "मिला",
    optNotFound: "नहीं मिला",
    optAllInfoCorrect: "सभी जानकारी सही है",
    optDeletion: "विलोपन",
    optCorrectionNeeded: "सुधार आवश्यक",
    optMigrated: "स्थानांतरित",
    optOthers: "अन्य",
    optCat18: "18 वर्ष पूर्ण",
    optCatMarriage: "विवाह",
    optCatWrongful: "गलत तरीके से हटाया गया",
    optCatNotInBaseRoll: "वोटर लिस्ट में नहीं",
    optCatOther: "अन्य",
    optCorrEntries: "मौजूदा मतदाता सूची की प्रविष्टियों में सुधार",
    optCorrShifting: "निवास स्थान का परिवर्तन",
    flagAbsent: "अनुपस्थित",
    flagExpired: "मृत",
    flagRepeated: "दोहराया गया",
    flagShifted: "स्थानांतरित",
    optFather: "पिता",
    optHusband: "पति",
    optMother: "माता",
    optMale: "पुरुष",
    optFemale: "महिला",
    optYes: "हाँ",
    optNo: "नहीं",
    optDash: "-",
    badgeFound: "मिला",
    badgeNotFound: "नहीं मिला",
    badgeNotStarted: "शुरू नहीं हुआ",
    badgeDupEpic: "डुप्लीकेट EPIC",
    badgeDeletedSource: "स्रोत सूची में हटाया गया",
    badgeModifiedSource: "स्रोत सूची में संशोधित",
    badgeSourceRollAddition: "स्रोत सूची अपडेट में जोड़ा गया",
    badgeUnidentifiedDeletion: "अज्ञात विलोपन",
    badgeS5Deleted: "पूरक 5 में हटाया गया",
    badgeS5Added: "पूरक 5 में जोड़ा गया",
    badgeS5Correction: "पूरक 5 में सुधार",
    badgeAddedField: "फील्ड में जोड़ा गया",
    badgeLocked: "लॉक्ड",
    badgePendingSync: "अभी सिंक नहीं हुआ",
    yrs: "वर्ष",
    metaHouse: "मकान",
    metaEpic: "EPIC",
    metaPart: "भाग",
    metaSrNo: "क्रम सं.",
    metaVerifiedBy: "सत्यापनकर्ता",
    metaAddedBy: "जोड़ने वाला",
    badgeAdditionType: "जोड़ा गया",
    badgeDeletionType: "हटाया गया",
    badgeCorrectionType: "सुधार",
    reopen: "फिर से खोलें",
    tabSearch: "बेस रोल 2025",
    tabSearchAll: "SEARCH",
    saPlaceholder: "मकान नंबर, EPIC नंबर, या नाम",
    saIntro: "बेस रोल, ड्राफ़्ट SIR 2026 रोल और ASDD सूची में एक साथ खोजें।",
    saOnAsddo: "ASDD",
    saPresentSir: "SIR में मौजूद",
    saNoSir: "SIR नहीं",
    saFieldAddNoSir: "फ़ील्ड में जोड़ा गया — अभी SIR में नहीं",
    saSrNo: "क्रम संख्या",
    saFieldVerif: "फ़ील्ड सत्यापन",
    saVerifiedBy: "सत्यापनकर्ता",
    saRoundAsddo: "ASDD पुनः-सत्यापन",
    saRoundDraftsir: "ड्राफ़्ट SIR पुनः-सत्यापन",
    saNotStarted: "शुरू नहीं हुआ",
    saPhRemarks: "जन सुनवाई",
    saCaseId: "केस आईडी",
    saCaseIdHint: "यह वोटर को दें — इससे उनका पूरा इतिहास खोजा जा सकता है।",
    saCaseIdPending: "सिंक होना बाकी",
    saCaseIdPendingHint: "इस डिवाइस पर सेव हो गया — ऑनलाइन सिंक होते ही केस आईडी मिलेगी।",
    saCaseType: "मामले का प्रकार",
    saCaseWrongAsdd: "ग़लत ASDD चिह्न",
    saCaseNoSir: "SIR नहीं",
    saCaseCorrection: "SIR सुधार अनुरोध",
    saPickCaseType: "पहले मामले का प्रकार चुनें।",
    saSaveCase: "मामला सेव करें",
    saSaved: "सेव हो गया।",
    saCaseRecordedBy: "मामला दर्ज किया",
    saSirSubmitted: "क्या उन्होंने SIR गणना फ़ॉर्म BLO को जमा किया?",
    saSirMode: "कैसे जमा किया गया?",
    saOnline: "ऑनलाइन",
    saOffline: "ऑफ़लाइन",
    saSirReceipt: "क्या उनके पास जमा करने की रसीद है?",
    saCorrectionFields: "क्या सुधारना है?",
    saFieldName: "नाम",
    saFieldAddress: "पता",
    saFieldAge: "उम्र",
    saFieldSex: "लिंग",
    saFieldRelName: "रिश्तेदार का नाम",
    saFieldRelType: "रिश्तेदार का प्रकार",
    saFieldOther: "अन्य",
    saOtherSpecify: "बताएं",
    saParticipation: "जन सुनवाई भागीदारी",
    saPartTestimony: "गवाही (Testimony)",
    saPartSupport: "सहायता / मदद",
    saPartOther: "अन्य",
    saPickParticipation: "पहले भागीदारी का प्रकार चुनें।",
    saPhone: "फ़ोन / संपर्क नंबर",
    saPhonePlaceholder: "10 अंकों का मोबाइल नंबर",
    saPhoneInvalid: "सही 10 अंकों का संपर्क नंबर दर्ज करें।",
    saIssueDescription: "समस्या का विवरण",
    saSupportType: "उन्हें किस तरह सहायता दी जाएगी?",
    saSupportForm6Self: "फ़ॉर्म 6 - स्वयं भरा जाए",
    saSupportForm6Assisted: "फ़ॉर्म 6 - सहायता से भरा जाए",
    saSupportOther: "अन्य",
    saRemarks: "टिप्पणी",
    saFollowUp: "फ़ॉलो-अप (कोई भी जोड़ सकता है)",
    saKnowsBlo: "क्या उन्हें पता है कि उनका BLO कौन है और क्या उनके पास उनका संपर्क विवरण है?",
    saBloUnknown: "इस भाग के लिए कोई BLO संपर्क दर्ज नहीं है।",
    saBloBoothOld: "पुराना बूथ नंबर",
    saBloBoothNew: "नया बूथ नंबर",
    saBloName: "BLO का नाम",
    saBloPhone: "BLO का फ़ोन नंबर",
    saBroughtToBlo: "क्या यह BLO के ध्यान में लाया गया?",
    saOtherRemarks: "अन्य टिप्पणी",
    saPhoneConfirmNote: "सेव करने से पहले पुष्टि करें कि यह सही संपर्क नंबर है:",
    saSaveFollowUp: "फ़ॉलो-अप सेव करें",
    saFollowUpRecordedBy: "फ़ॉलो-अप दर्ज किया",
    tabDashboard: "डैशबोर्ड",
    dashBaseTotal: "मूल सूची कुल",
    dashCompleted: "सत्यापन पूर्ण",
    dashPending: "लंबित",
    dashAdditions: "जोड़े गए",
    dashDeletions: "हटाए गए",
    dashCorrections: "सुधार",
    dashNotFoundShifted: "नहीं मिले – स्थानांतरित",
    dashRevisedTotal: "संशोधित कुल",
    dashRevisedFormula: "मूल सूची में मिले + जोड़े गए − हटाए गए",
    dashPercent: "% पूर्ण",
    partsTitle: "भाग अनुसार प्रगति",
    partCol: "भाग",
    partColBase: "मूल सूची",
    partColDone: "पूर्ण",
    partColAdditions: "जोड़े गए",
    partColDeletions: "हटाए गए",
    partColCorrections: "सुधार",
    viewList: "सूची देखें →",
    dashProgressTitle: "सत्यापन प्रगति",
    dashFound: "मिले",
    dashNotFound: "नहीं मिले",
    drillShowing: "दिखा रहे हैं",
    drillClear: "साफ़ करें",
    drillUniqueVoters: "अद्वितीय मतदाता",
    partsFootnote:
      "भाग कुल सूची प्रविष्टियाँ गिनते हैं। कुछ मतदाता दो भागों में नामांकित हैं (और पूरक 5 भाग-परिवर्तन दोनों प्रविष्टियाँ रखते हैं), इसलिए भागों का योग ऊपर दिए अद्वितीय-मतदाता मूल सूची कुल से अधिक होता है।",
    drillSummary: "प्रकार अनुसार",
    notSpecified: "अनिर्दिष्ट",
    mySummaryTitle: "मेरी गतिविधि",
    mySummaryVerifications: "सत्यापन",
    mySummaryAdditions: "जोड़े गए",
    mySummaryDeletions: "हटाए गए",
    mySummaryCorrections: "सुधार",
    dailyActivityTitle: "दैनिक गतिविधि",
    dailyActivityDate: "तारीख",
    dailyActivityStaff: "कर्मचारी",
    dailyActivityVerifications: "सत्यापन",
    dailyActivityAdditions: "जोड़े गए",
    dailyActivityDeletions: "हटाए गए",
    dailyActivityCorrections: "सुधार",
    dailyActivityTotal: "कुल",
    dailyActivityEmpty: "इस तारीख के लिए कोई गतिविधि दर्ज नहीं है।",
    tabTeam: "टीम",
    tabSourceUpdate: "जोड़े गए (फ़र॰ 2025 - जून 2026)",
    tabUnidentifiedDeletions: "अज्ञात विलोपन (फ़र॰ 2025 - जून 2026)",
    tabMonthlyPooling: "मासिक पूलिंग (फ़र॰ 2025 - जून 2026)",
    tabAsddo: "ASDD सूची",
    tabDraftsir: "ड्राफ़्ट SIR 2026",
    tabReverify: "PH डैशबोर्ड",
    rvTitle: "PH डैशबोर्ड",
    rvUpdated: "अपडेट",
    rvDoubleCheck: "दोबारा जाँच",
    rvDone: "पूर्ण",
    rvReverified: "पुनः सत्यापित",
    rvLeft: "शेष",
    rvSettled: "स्थिर",
    rvRefuted: "अस्वीकृत",
    rvOther: "अन्य",
    rvBaseChanges: "बेस रोल परिवर्तन",
    rvAllTiles: "सभी टाइलें",
    rvVdConfirmed: "पुष्ट",
    rvVdRefuted: "अस्वीकृत",
    rvVdOther: "अन्य",
    rvVdPending: "लंबित",
    rvBy: "द्वारा",
    rvWas: "था",
    rvNow: "अब",
    rvChangedSince: "स्नैपशॉट के बाद बेस रोल बदला",
    rvNewCandidates: "अभी टाइल में नहीं — बेस रोल अब इन्हें योग्य बनाता है",
    rvNoRows: "कोई पंक्ति नहीं।",
    rvNoneDone: "इस टाइल में अभी कुछ पुनः सत्यापित नहीं।",
    rvPendingNote: "अभी पुनः सत्यापित करना शेष (ASDD सूची / ड्राफ़्ट SIR टैब से)",
    monthlyPoolingSource:
      'स्रोत: जोड़, विलोपन और संशोधन का सारांश, मुख्य निर्वाचन अधिकारी, तेलंगाना।',
    loading: "लोड हो रहा है…",
    statusOfflineShort: "ऑफ़लाइन",
    wlLoading: "लोड हो रहा है…",
    wlSearchBtn: "खोजें",
    wlBack: "वापस",
    wlSearchPlaceholder: "मकान नंबर, EPIC ID, या नाम",
    wlOffline: "ऑफ़लाइन",
    wlOfflineShort: "ऑफ़लाइन",
    wlAllTiles: "सभी टाइलें",
    wlAnomaliesTitle: "विसंगतियाँ",
    wlInHouses: "{n} घरों में",
    wlDone: "पुनः सत्यापित",
    wlDoubleCheck: "दोबारा जाँच के लिए",
    wlVoters: "मतदाता",
    wlHouses: "घर",
    wlVoterWord: "मतदाता",
    wlHouseWord: "घर",
    wlPart: "भाग",
    wlNewPart: "नया भाग",
    wlHouse: "मकान",
    wlSegConfirmed: "पुष्ट — फिर से पुष्टि करें",
    wlSegDoubleCheck: "पहले दोबारा जाँचें",
    wlDc: "दोबारा जाँच",
    wlWeFound: "हमने पाया",
    wlWhy: "संकेत",
    wlOurNote: "हमारा नोट",
    wlPrevBy: "पहले सत्यापित किया",
    wlReverified: "पुनः सत्यापित:",
    wlResults: "परिणाम",
    wlNoResults: "इस सूची में उससे कोई मेल नहीं खाता।",
    okTitle: "सिकंदराबाद छावनी — घर-वार स्थिति",
    okQNoticeRecv: "क्या मतदाता को नोटिस की भौतिक प्रति मिल गई है?",
    okQHearing: "सुनवाई की स्थिति",
    okHrCompleted: "पूरी हो गई",
    okHrDue: "बाकी है",
    okHrNotKnown: "पता नहीं",
    okQDocs: "क्या मतदाता ने ज़रूरी दस्तावेज़ BLO को जमा कर दिए हैं?",
    okDocUnaware: "पता नहीं कौन-से दस्तावेज़ देने हैं",
    okQDelStatus: "विलोपन की ज़मीनी स्थिति",
    okDelWrongful: "ग़लत विलोपन",
    okDelValid: "सही विलोपन",
    okQDelAware: "क्या मतदाता को विलोपन का कारण पता है?",
    okQDelGot: "क्या मतदाता को SIR गणना फ़ॉर्म मिला था?",
    okQDelSubmitted: "क्या उन्होंने SIR गणना फ़ॉर्म BLO को जमा किया?",
    okErrNoticeRecv: "कृपया बताएँ कि मतदाता को नोटिस की भौतिक प्रति मिली या नहीं।",
    okErrHearing: "कृपया सुनवाई की स्थिति चुनें।",
    okErrDocs: "कृपया बताएँ कि ज़रूरी दस्तावेज़ BLO को जमा हुए या नहीं।",
    okErrDelStatus: "कृपया ज़मीनी स्थिति चुनें: ग़लत या सही विलोपन।",
    okErrDelAware: "कृपया बताएँ कि मतदाता को विलोपन का कारण पता है या नहीं।",
    okErrDelGot: "कृपया बताएँ कि मतदाता को SIR गणना फ़ॉर्म मिला या नहीं।",
    okErrDelSub: "कृपया बताएँ कि गणना फ़ॉर्म BLO को जमा हुआ या नहीं।",
    okNoticeWhy: "नोटिस क्यों जारी हुआ",
    okNoticeCount: "{n} कारण",
    okNrBlankLabel: "कारण छपा नहीं है",
    okNrParentName: "रोल में माता-पिता का नाम जुड़े हुए पुराने रिकॉर्ड से मेल नहीं खाता।",
    okNrSelfName: "रोल में मतदाता का अपना नाम जुड़े हुए पुराने रिकॉर्ड से मेल नहीं खाता।",
    okNrUnmapped: "मतदाता का नाम 2002 की सूची से नहीं जुड़ सका।",
    okNrProgeny6: "एक ही माता-पिता से छह या अधिक संतानें जुड़ी हैं।",
    okNrProgenyGap: "एक ही माता-पिता से जुड़ी दो संतानों की उम्र में 9 महीने से कम का अंतर है।",
    okNrParentLt15: "माता-पिता मतदाता से 15 साल से कम बड़े हैं।",
    okNrParentGt50: "माता-पिता मतदाता से 50 साल से ज़्यादा बड़े हैं।",
    okNrGrandLt40: "दादा-दादी/नाना-नानी मतदाता से 40 साल से कम बड़े हैं।",
    okNrParentIneligible: "पिछले SIR में माता-पिता को अपात्र चिह्नित किया गया था।",
    okNrBlank: "नोटिस सूची में इस मतदाता का कारण नहीं छपा है — BLO से पूछें।",
    okVerifyBtn: "दौरे का सत्यापन करें",
    okEditVisit: "दौरा बदलें",
    okVerified: "दौरा दर्ज",
    okYes: "हाँ",
    okNo: "नहीं",
    okUnable: "सत्यापित नहीं कर सके",
    okQCorrect: "क्या ASDD चिह्न सही है?",
    okQWrong: "ASDD चिह्न में क्या ग़लत है?",
    okChoose: "चुनें…",
    okWrShifted: "ग़लती से स्थानांतरित दर्शाया गया",
    okWrDead: "ग़लती से मृत दर्शाया गया",
    okWrAbsent: "ग़लती से अनुपस्थित दर्शाया गया",
    okWrDup: "ग़लती से दोहराव दर्शाया गया",
    okQEnum: "क्या गणना फ़ॉर्म जमा हुआ था?",
    okEnYes: "हाँ",
    okEnNotRecv: "BLO से नहीं मिला",
    okEnNotGen: "फ़ॉर्म बना ही नहीं",
    okEnNotColl: "बिना जमा किया फ़ॉर्म निर्वाचक के पास मिला",
    okEnOther: "अन्य",
    okQForm6: "क्या मतदाता ने अब BLO को फ़ॉर्म 6 जमा कर दिया है?",
    okQAssist: "क्या मतदाता को फ़ॉर्म 6 भरने में सहायता चाहिए?",
    okQGiven: "फ़ॉर्म 6 दिया और भरना समझाया?",
    okGuideHd: "मतदाता को फ़ॉर्म 6 दें और भरना समझाएँ:",
    okGuide1: "खाली फ़ॉर्म 6 दें (BLO के पास मिलता है; voters.eci.gov.in या Voter Helpline ऐप पर ऑनलाइन भी भरा जा सकता है)।",
    okGuide2: "नाम, रिश्तेदार का नाम, जन्म तिथि और लिंग: मतदाता पहचान पत्र या अन्य प्रमाण में छपे अनुसार ही लिखें।",
    okGuide3: "वर्तमान पता: मकान नंबर, मोहल्ला और पार्ट। अगर पहले कहीं और रहते थे तो वह पता भी लिखें।",
    okGuide4: "पूर्व पंजीकरण: पुराना EPIC नंबर {epic} और पुराना पार्ट {part} लिखें।",
    okGuide5: "आयु और पते का प्रमाण (जैसे आधार, जन्म या स्कूल प्रमाणपत्र, राशन कार्ड या बिजली-पानी का बिल) और हाल की फ़ोटो लगाएँ।",
    okGuide6: "घोषणा पर हस्ताक्षर करें और फ़ॉर्म BLO को दें। पावती माँगें और उसकी फ़ोटो लें।",
    okGuide7: "प्रारूप सूची से छूटे मतदाताओं के दावे 30 अक्टूबर 2026 तक खुले हैं। मदद के लिए वोटर हेल्पलाइन 1950 पर कॉल करें।",
    okQPhone: "मतदाता का फ़ोन नंबर",
    okQPhoneOpt: "मतदाता का फ़ोन नंबर (वैकल्पिक)",
    okErrPhoneOpt: "फ़ोन नंबर 10 अंकों का होना चाहिए — या खाली छोड़ दें।",
    okPhoneHint: "10 अंकों का मोबाइल नंबर",
    okQRemarks: "टिप्पणी",
    okQRemarksReq: "टिप्पणी (“अन्य” चुनने पर ज़रूरी)",
    okSave: "दौरा सहेजें",
    okSaving: "सहेज रहे हैं…",
    okCancel: "रद्द करें",
    okSavedToast: "दौरा सहेजा गया",
    okErrCorrect: "कृपया बताएँ कि ASDD चिह्न सही है या नहीं।",
    okErrWrong: "कृपया चुनें कि ASDD चिह्न कैसे ग़लत है।",
    okErrEnum: "कृपया बताएँ कि गणना फ़ॉर्म जमा हुआ था या नहीं।",
    okErrRemarks: "कृपया टिप्पणी में “अन्य” समझाएँ।",
    okErrForm6: "कृपया बताएँ कि फ़ॉर्म 6 जमा हुआ या नहीं।",
    okErrAssist: "कृपया बताएँ कि मतदाता को फ़ॉर्म 6 में सहायता चाहिए या नहीं।",
    okErrGiven: "कृपया बताएँ कि फ़ॉर्म 6 दिया और भरना समझाया या नहीं।",
    okErrPhone: "10 अंकों का फ़ोन नंबर ज़रूरी है।",
    okErrEmptyVisit: "सहेजने से पहले कम से कम एक उत्तर भरें।",
    okErrOffline: "कनेक्शन नहीं — दौरा सहेजा नहीं गया। ऑनलाइन होने पर फिर कोशिश करें।",
    okErrSave: "सहेज नहीं सके। कृपया फिर कोशिश करें।",
    okBaseTotal: "आधार सूची कुल (2025 सूची + मासिक बदलाव)",
    okBaseSub: "2025 सूची में {roll} + {add} जुड़े − मासिक सूचियों में {del} हटे",
    okDraftTotal: "प्रारूप SIR 2026 में शामिल",
    okDraftSub: "2025 सूची से {roll} + बाद में जुड़े {add}",
    okAddedSince: "जनवरी 2025 के बाद जुड़ा",
    okAddedMonth: "{m} में जुड़ा",
    okNamePartial: "नाम अधूरा (पहले 10 अक्षर)",
    okEpicPrefix: "ठीक यही EPIC नहीं मिला — इससे शुरू होने वाले EPIC दिख रहे हैं।",
    okAuditScope: "2025 पार्ट {range}",
    okFromHH: "घर के अनुसार",
    okEnNotColl2: "फ़ॉर्म BLO ने नहीं लिया",
    okEnFound: "गणना फ़ॉर्म मतदाता के पास मिला",
    okDocYesSir: "हाँ — SIR सूची का दस्तावेज़",
    okDocYesOther: "हाँ — पर SIR सूची का नहीं",
    okQCorrections: "क्या इस मतदाता की प्रविष्टि में कोई सुधार चाहिए?",
    okCorNone: "कोई सुधार नहीं चाहिए",
    okCorName: "नाम",
    okCorDob: "जन्म तिथि / आयु",
    okCorGender: "लिंग",
    okCorPhoto: "फ़ोटो",
    okCorRelName: "संबंधी का नाम",
    okCorRelType: "संबंध का प्रकार",
    okCorAddress: "पता",
    okQForm8: "क्या मतदाता ने फ़ॉर्म 8 जमा किया है?",
    okForm8Hint: "फ़ॉर्म 8 मौजूदा प्रविष्टि सुधारता है। हो सके तो भरने में मदद करें, और टिप्पणी में लिखें कि क्या ग़लत है।",
    okQHasId: "क्या मतदाता के पास वोटर ID की प्रति या फ़ोटो है?",
    okQEpicText: "वोटर ID नंबर (यदि बता सकें)",
    okQLastVoted: "उन्होंने आख़िरी बार कब मतदान किया?",
    okLastVotedHint: "जैसे 2023 विधानसभा, कभी नहीं",
    okQForm6Mode: "क्या मतदाता ने फ़ॉर्म 6 जमा किया है?",
    okF6Online: "हाँ — ऑनलाइन",
    okF6Offline: "हाँ — काग़ज़ पर",
    okF6Both: "हाँ — दोनों",
    okQAckNo: "पावती संख्या (यदि उपलब्ध हो)",
    okSamePhone: "{phone} उपयोग करें (वही घर)",
    okQDocsUpload: "फ़ोटो या दस्तावेज़ ({n} तक)",
    okDocCamera: "फ़ोटो लें",
    okDocFile: "फ़ाइल जोड़ें",
    okDocRemove: "हटाएँ",
    okDocFull: "{n} जोड़े जा चुके — दूसरा जोड़ने के लिए एक हटाएँ",
    okDocFailed: "यह फ़ाइल नहीं पढ़ी जा सकी। इसके बजाय फ़ोटो लेकर देखें।",
    okF6ReqHd: "फ़ॉर्म 6 के लिए क्या चाहिए",
    okF6Req1: "स्पष्ट पासपोर्ट साइज़ फ़ोटो",
    okF6Req2: "आधार कार्ड",
    okF6Req3: "स्व-सत्यापित पहचान प्रमाण (हो सके तो आधार न दें)",
    okF6Req4: "स्व-सत्यापित पता प्रमाण (हो सके तो आधार न दें)",
    okF6Req5: "उसी पते के किसी संबंधी का वोटर ID, संदर्भ के लिए",
    okF6Req6: "डाकघर का नाम",
    okF6Req7: "SIR 2002 विवरण — स्वयं या माता-पिता का",
    okF6Req8: "ऑनलाइन आवेदन के लिए मोबाइल नंबर",
    okReasonAll: "सभी कारण",
    okReasonFilter: "कारण",
    okFocusScope: "2026 बूथ {booths} — जिन बूथों का सर्वे हो रहा है",
    okPartWord: "पार्ट",
    okBoothWord: "बूथ",
    okSNotice: "नोटिस",
    okSAsdd: "ASDD",
    okSDeleted: "विलोपित",
    okTileDeleted: "SIR से पहले विलोपन",
    okSCleared: "SIR क्लियर",
    okSNoSir: "SIR में नहीं",
    okSPending: "प्रारूप सूची प्रतीक्षित",
    okSUnlinked: "EPIC नहीं",
    okAllParts: "सभी पार्ट",
    okCritical: "गंभीर पार्ट",
    okOtherParts: "अन्य पार्ट",
    okSClearedAssumed: "क्लियर (अनुमानित)",
    okSearchPlaceholder: "मकान नंबर, EPIC या नाम",
    okClear: "साफ़ करें",
    okPartHint: "मकान नंबर कई बूथों में दोहराए जाते हैं — खोज सीमित करने के लिए बूथ चुनें। नामावली की नई नंबरिंग के कारण 2026 बूथ और 2025 पार्ट दोनों दिखाए जाते हैं।",
    okOldPart: "2025 पार्ट",
    okNewPart: "2026 बूथ",
    okEst: "अनुमानित",
    okFloor: "मंज़िल",
    okSupplement: "जनवरी 2025 के पूरक में जुड़ा",
    okNoEpic: "EPIC नहीं",
    okAltEpic: "दूसरा EPIC",
    okHouse: "मकान",
    okNoHouse: "मकान नंबर दर्ज नहीं",
    okNoBlock: "ब्लॉक दर्ज नहीं",
    okMember1: "1 मतदाता",
    okMembers: "{n} मतदाता",
    okRestored: "इस मतदाता की आपकी बिना सहेजी प्रविष्टि वापस आ गई है।",
    okQueuedToast: "कनेक्शन नहीं — आपकी प्रविष्टि इस फ़ोन में रखी है और अपने-आप भेज दी जाएगी।",
    okWaiting: "भेजने की प्रतीक्षा में — इस फ़ोन में रखी है",
    okBannerWaiting: "{n} प्रविष्टियाँ भेजने की प्रतीक्षा में हैं। फ़ोन ऑनलाइन होते ही अपने-आप चली जाएँगी।",
    okBannerRejected: "{n} प्रविष्टियाँ सहेजी नहीं जा सकीं:",
    okBannerDrafts: "{n} प्रविष्टियाँ लिखी गईं पर अभी सहेजी नहीं:",
    okSendNow: "अभी भेजें",
    okOpen: "खोलें",
    okSentToast: "{n} प्रतीक्षारत प्रविष्टियाँ सहेज ली गईं।",
    okMergedToast: "सहेजा गया। {name} यह दौरा पहले ही सहेज चुके थे — उत्तर मिला दिए गए हैं।",
    okMergedChanged: " ({n} उत्तर बदले)",
    okSomeoneElse: "किसी और ने",
    okTabSearch: "खोज",
    okTabProgress: "प्रगति",
    okTabHearing: "जन सुनवाई",
    okTabHearingDash: "सुनवाई डैशबोर्ड",
    phDashTitle: "जन सुनवाई",
    phDashAt: "समय",
    phDashRefresh: "ताज़ा करें",
    phDashTotal: "जारी टोकन",
    phDashOther: "अन्य",
    phDashByCounter: "काउंटर के अनुसार",
    phDashCounter: "काउंटर",
    phDashTokens: "टोकन",
    phDashExit: "एग्ज़िट डेस्क",
    phDashExitDone: "एग्ज़िट डेस्क दर्ज",
    phDashTestYes: "गवाही दी: हाँ",
    phDashTestNo: "गवाही दी: नहीं",
    phDashIssuers: "टोकन जारी करने वाले",
    phDashVolunteer: "स्वयंसेवक",
    okTwinHd: "संभावित दोहरी प्रविष्टि",
    okTwinSub: "वही नाम, आयु, लिंग और मकान, दूसरे EPIC के साथ दर्ज। दोनों प्रविष्टियाँ और उनकी स्थिति:",
    okChgHd: "2025 की सूची के बाद बदलाव",
    okChgName: "नाम",
    okChgAge: "आयु",
    okChgGender: "लिंग",
    okChgRel: "संबंधी",
    okChgHouse: "मकान",
    okChgMonthly: "मासिक सूचियों में संशोधन:",
    phPlaceholder: "EPIC नंबर या मकान नंबर",
    phHint: "जन सुनवाई में आए मतदाता को खोजें, फिर उनके नाम के आगे जन सुनवाई बटन दबाएँ।",
    phIdle: "मतदाता को खोजने के लिए EPIC नंबर या मकान नंबर लिखें।",
    phBtn: "जन सुनवाई",
    phFormTitle: "जन सुनवाई टोकन",
    phLName: "नाम",
    phLRelative: "संबंधी",
    phLAgeSex: "आयु / लिंग",
    phLEpic: "EPIC नंबर",
    phLHouse: "मकान",
    phLParts: "पार्ट",
    phLBlock: "ब्लॉक",
    phLStatus: "SIR स्थिति",
    phBlockNone: "ब्लॉक दर्ज नहीं (टोकन PH-MISC होगा)",
    phPhone: "फ़ोन नंबर (वैकल्पिक)",
    phPhoneHint: "10 अंकों का मोबाइल नंबर",
    phIssue: "टोकन जारी करें",
    phIssuing: "जारी हो रहा है…",
    phNoPhoneConfirm: "फ़ोन नंबर नहीं लिखा गया है। क्या बिना फ़ोन नंबर के टोकन जारी करें?",
    phErrIssue: "टोकन जारी नहीं हो सका। कृपया फिर कोशिश करें।",
    phOffline: "टोकन के लिए इंटरनेट चाहिए। नेटवर्क आने पर फिर कोशिश करें।",
    phTokenTitle: "टोकन नंबर",
    phCounter: "इस काउंटर पर जाएँ",
    phTellThem: "मतदाता को उनका टोकन नंबर बताएँ",
    phExisting: "इस मतदाता का टोकन पहले से बना है। वही दोबारा दिखाया गया है।",
    phDone: "ठीक है",
    phExitBtn: "एग्ज़िट डेस्क",
    phLToken: "टोकन",
    phPhoneShort: "फ़ोन नंबर",
    phExitTitle: "एग्ज़िट डेस्क",
    phQTestimony: "जन सुनवाई में गवाही",
    phYes: "हाँ",
    phNo: "नहीं",
    phQStatus: "जन सुनवाई की स्थिति (जो लागू हों सब चुनें)",
    phS1: "फ़ॉर्म 6 + स्व-घोषणा भरी गई",
    phS2: "फ़ॉर्म 6 + स्व-घोषणा BLO को जमा की गई",
    phS3: "BLO से पावती रसीद मिली",
    phS4: "नोटिस के बारे में सहायता दी गई",
    phS5: "पहली बार वोट डालने वाले का फ़ॉर्म 6 भरा गया",
    phQRemarks: "टिप्पणी",
    phExitSave: "एग्ज़िट विवरण सहेजें",
    phExitSaved: "एग्ज़िट विवरण सहेजा गया",
    phExitNeedAny: "कम से कम एक उत्तर भरें।",
    phExitRecorded: "एग्ज़िट डेस्क दर्ज",
    phExitSavedBy: "अंतिम बार सहेजा",
    okAllInScope: "डैशबोर्ड में सब कुछ",
    okRefresh: "ताज़ा करें",
    okUpdated: "अपडेट",
    okProgCovered: "कितना काम हो चुका है",
    okElectorsCovered: "मतदाता पूरे हुए",
    okHousesCovered: "पूरी तरह हो चुके घर",
    okDone: "पूरा",
    okLeft: "बाकी",
    okHousesPartly: "आंशिक",
    okHousesNotStarted: "शुरू नहीं हुए",
    okVisitsToday: "आज के दौरे",
    okVisitsTodaySub: "आज सहेजे गए",
    okProgFound: "दौरों में क्या मिल रहा है",
    okOfAsddVisits: "{n} ASDD दौरों में से ({p}%)",
    okOfDelVisits: "{n} विलोपन दौरों में से",
    okOffNow: "ऑफ़लाइन",
    okOffReady: "इस फ़ोन पर ऑफ़लाइन प्रति: {n} मतदाता, अपडेट {when}",
    okOffFirst: "कनेक्शन मिलते ही भाग 59–69 की ऑफ़लाइन प्रति डाउनलोड होगी…",
    okOffNone: "इस फ़ोन पर अभी ऑफ़लाइन प्रति नहीं है — एक बार इंटरनेट से जुड़कर डाउनलोड करें",
    okOffDownloading: "ऑफ़लाइन प्रति डाउनलोड हो रही है… भाग {i} / {n}",
    okOffUpdate: "ऑफ़लाइन प्रति अपडेट करें",
    okOffSyncFail: "ऑफ़लाइन प्रति अपडेट नहीं हो सकी — बेहतर कनेक्शन पर फिर कोशिश करें",
    okOffNoCopy: "कनेक्शन नहीं है और इस फ़ोन पर ऑफ़लाइन प्रति भी नहीं है। एक बार इंटरनेट से जुड़कर डाउनलोड करें।",
    okOffResults: "इस फ़ोन में सहेजी प्रति में खोज (केवल भाग 59–69)। नई प्रविष्टियाँ इंटरनेट आते ही अपने-आप भेज दी जाएँगी।",
    okOfNoticeVisits: "{n} नोटिस दौरों में से ({p}%) · सुनवाई और दस्तावेज़ बाक़ी",
    okProgVolunteers: "स्वयंसेवक",
    okVolunteer: "स्वयंसेवक",
    okToday: "आज",
    okTotal: "कुल",
    okNoVisitsYet: "अभी कोई दौरा सहेजा नहीं गया।",
    okProgByPart: "बूथ के अनुसार",
    okHousesTouched: "देखे गए घर",
    okBackToProgress: "प्रगति पर वापस",
    okListCount: "{h} घरों में {e} मतदाता",
    okKElectorsDone: "पूरे हुए मतदाता",
    okKElectorsLeft: "मिलना बाकी मतदाता",
    okKAsddDone: "ASDD जिनसे मिले",
    okKAsddLeft: "ASDD मिलना बाकी",
    okKNoticeDone: "नोटिस जिनसे मिले",
    okKNoticeLeft: "नोटिस मिलना बाकी",
    okKDeletedDone: "SIR से पहले विलोपन जिनसे मिले",
    okKDeletedLeft: "SIR से पहले विलोपन मिलना बाकी",
    okKAsddWrong: "ASDD चिह्न ग़लत",
    okKAsddRight: "ASDD चिह्न सही",
    okKAsddUnable: "ASDD जाँच नहीं हो सकी",
    okKNoticeNotRecv: "नोटिस नहीं मिला",
    okKNoticeUnable: "नोटिस की जाँच नहीं हो सकी",
    okKHearingDue: "सुनवाई बाकी",
    okKDocsNo: "दस्तावेज़ जमा नहीं",
    okKWrongful: "ग़लत प्री-SIR विलोपन",
    okKTotalCases: "कुल मामले",
    okTotalCasesSub: "ASDD ग़लत + ग़लत प्री-SIR विलोपन",
    okKToday: "आज के दौरे",
    okKHousesDone: "पूरी तरह हो चुके घर",
    okKHousesPartial: "आंशिक रूप से हुए घर",
    okKHousesNone: "शुरू नहीं हुए घर",
    okKHousesAll: "सभी घर",
    okBlockWord: "ब्लॉक",
    okAllBlocks: "सभी ब्लॉक",
    okPrev: "पिछला",
    okNext: "अगला",
    okPage: "पृष्ठ {a} / {b}",
    okPartsWith: "“{s}” वाले मतदाताओं के पार्ट — खोलने के लिए चुनें",
    okIdle: "बूथ चुनें, या सिकंदराबाद छावनी के किसी भी मतदाता को EPIC, नाम या मकान नंबर से खोजें। किन बूथों में हैं, यह देखने के लिए ऊपर की संख्या दबाएँ।",
    okNoResults: "कोई मतदाता नहीं मिला।",
    okNeedPart: "यह मकान नंबर कई पार्टों में है — सीमित करने के लिए पार्ट चुनें।",
    okLetterHouse: "ब्लॉक अक्षर वाला वही नंबर और उसके उप-मकान भी दिख रहे हैं (जैसे “50” के लिए F50 और F50/A)।",
    okPrefixHouse: "ठीक यही मकान नहीं मिला — इस नंबर से शुरू होने वाले मकान दिख रहे हैं।",
    okTruncated: "पहले {n} नतीजे दिख रहे हैं — सीमित करने के लिए पार्ट चुनें या और लिखें।",
    okHouseholdsCount: "{n} घर",
    okDelRoll: "जनवरी 2025 की सूची में कटा: {r}",
    okDelMonthly: "{m} की मासिक विलोपन सूची में हटाया (कारण प्रकाशित नहीं)",
    wlOnWorklist: "कार्य-सूची में",
    wlFlaggedFor: "पुनः सत्यापन के लिए चिह्नित",
    wlNoReverifyNeeded: "कोई पुनः सत्यापन चिह्नित नहीं",
    wlOtherFlags: "अन्य फ़्लैग",
    wlOtherFlagsTitle: "इस घर पर अन्य फ़्लैग \u2014 मिलने पर यहाँ दर्ज करें",
    wlEdit: "पुनः सत्यापन संपादित करें",
    wlVerifyBtn: "पुनः सत्यापित करें",
    wlOutcomeLabel: "दोबारा जाने पर आपने क्या पाया?",
    wlNotesLabel: "टिप्पणियाँ",
    wlRemarkLabel: "टिप्पणी (आवश्यक)",
    wlNeedRemark: "“अन्य” के रूप में सेव करने के लिए टिप्पणी लिखें।",
    wlSaveBtn: "पुनः सत्यापन सेव करें",
    wlCancel: "रद्द करें",
    wlPickOutcome: "चुनें कि आपने क्या पाया।",
    wlErrSaving: "सेव करने में त्रुटि।",
    wlSaved: "सेव हो गया।",
    wlPhotoAttached: "फोटो जोड़ी गई।",
    wlAddPhoto: "फ़ोटो जोड़ें",
    wlRemove: "हटाएँ",
    wlSirLabel: "क्या उन्होंने SIR गणना फॉर्म BLO को जमा किया?",
    wlSirYes: "हाँ",
    wlSirNo: "नहीं",
    wlSirOnline: "ऑनलाइन जमा किया",
    wlVotedLabel: "क्या उन्होंने 2023 तेलंगाना विधानसभा चुनाव में मतदान किया?",
    wlJanLabel: "कैंप कम जन सुनवाई — क्या वे भाग लेंगे?",
    wlJanParticipate: "भाग लेंगे",
    wlJanSpeak: "बोलेंगे",
    wlJanNo: "नहीं",
    wlYes: "हाँ",
    wlNo: "नहीं",
    wlPhoneLabel: "फ़ोन नंबर",
    wlPhotoLabel: "फोटो",
    wlOutAlive: "जीवित — पते पर मिले",
    wlOutDead: "मृत — पुष्ट",
    wlOutPresent: "पते पर मौजूद",
    wlOutShifted: "स्थायी रूप से स्थानांतरित / पलायन",
    wlOutAbsent: "ग़ैर-हाज़िर — मौजूद नहीं",
    wlOutNoDup: "कोई डुप्लीकेट नहीं मिला",
    wlOutDup: "डुप्लीकेट — पुष्ट",
    wlOutFound: "पते पर मिले",
    wlOutNotFound: "नहीं मिले",
    wlOutFoundPresent: "मिले और पते पर मौजूद",
    wlOutOther: "अन्य — बस एक टिप्पणी लिखें",
    // -- PH FOLLOW UP --
    tabPhFollowup: "PH फॉलो अप",
    phfTitle: "जन सुनवाई मामलों का फॉलो-अप",
    phfSearchPlaceholder: "मकान नंबर, EPIC ID, या नाम — कोई भी मतदाता, केवल जन सुनवाई मामले नहीं",
    phfCasesEmpty: "अभी तक कोई जन सुनवाई मामला दर्ज नहीं है।",
    phfCaseWord: "मामला",
    phfCases: "मामले",
    phfClosedWord: "बंद",
    phfCaseTag: "जन सुनवाई मामला",
    phfNoCaseTag: "कोई जन सुनवाई मामला दर्ज नहीं",
    phfQ1: "क्या BLO ने आपसे संपर्क किया है?",
    phfQ2: "क्या आपने अपना फॉर्म 6 जमा कर दिया है?",
    phfQ3: "क्या आपको फॉर्म 6 जमा करने में सहायता चाहिए?",
    phfQ4: "क्या आपको नोटिस मिला है?",
    phfClosedTag: "फॉर्म 6 जमा — बंद",
    phfFollowUpBtn: "फॉलो अप करें",
    phfEditBtn: "फॉलो-अप संपादित करें",
    phfSaveBtn: "फॉलो-अप सेव करें",
    phfSaved: "फॉलो-अप सेव हो गया।",
    phfErrSaving: "सेव करने में त्रुटि। पुनः प्रयास करें।",
    phfNoResults: "कोई मतदाता मेल नहीं खाता।",
    phfUpdatedBy: "आख़िरी बार अपडेट किया",
    phfSelectPart: "भाग चुनें",
    phfSelectHouse: "मकान चुनें",
    phfChoose: "— चुनें —",
    phfGovLabel: "PH स्थिति",
    phGovInDraft: "ड्राफ़्ट SIR सूची में",
    phGovNoSir: "NO SIR (हटाया गया)",
    phGovFieldAddition: "फ़ील्ड में जोड़ा गया — किसी सूची में नहीं",
    phfTileHouseholdsLabel: "घर",
    phfTileCasesLabel: "मामले (व्यक्ति)",
    phfTileBloLabel: "BLO ने संपर्क किया",
    phfTileForm6Label: "फॉर्म 6 जमा",
    phfTileAssistLabel: "फॉर्म 6 में सहायता चाहिए",
    phfTileNoticeLabel: "नोटिस मिला",
    phfCompletedWord: "पूर्ण",
    phfFilteredBy: "फ़िल्टर किया गया",
    phfNoHouseholds: "इस फ़िल्टर से कोई घर मेल नहीं खाता।",
    phfTilesTitle: "फॉलो-अप प्रगति",
    phfCompletedByPartTitle: "पूर्ण मामले, भाग अनुसार",
    phfHideCompleted: "छुपाएं",
    phfNotesLabel: "टिप्पणियाँ",
    phfNotesPlaceholder: "इस विज़िट के बारे में कुछ और दर्ज करना हो तो यहाँ लिखें",
    asddoTileDead: "ASDD में मृतक — जीवित पाए गए",
    asddoTilePshift: "स्थायी रूप से स्थानांतरित — पते पर मौजूद",
    asddoTileAbsent: "ग़ैर-हाज़िर / अनुपलब्ध — पते पर मौजूद",
    asddoTileEnrolled: "डुप्लीकेट — मौजूद, कोई डुप्लीकेट नहीं मिला",
    asddoTileNotbase: "ASDD सूची में हैं, हमारे बेस रोल में नहीं",
    asddoListSays: "ASDD कहती है",
    asddoMovedLabel: "क्या वे कहीं और मतदाता थे और हाल ही में यहाँ आए हैं?",
    asddoReasonDeath: "मृत्यु",
    asddoReasonShifted: "स्थायी रूप से स्थानांतरित",
    asddoReasonAbsent: "अनुपलब्ध / ग़ैर-हाज़िर",
    asddoReasonEnrolled: "पहले से नामांकित",
    draftsirTileDead: "हमने मृतक चिह्नित किया — पर ड्राफ़्ट SIR रोल में हैं",
    draftsirTileNotBase: "ड्राफ़्ट SIR रोल में हैं — हमारे बेस रोल में नहीं",
    draftsirTileVerified: "पते पर मौजूद पाए गए — ड्राफ़्ट या ASDD सूची में नहीं",
    draftsirTilePending: "बेस रोल में हैं, अभी सत्यापित नहीं — ड्राफ़्ट या ASDD सूची में नहीं",
    draftsirTileAddition: "फ़ील्ड में जोड़े गए — ड्राफ़्ट या ASDD सूची में नहीं",
    draftsirInRoll: "प्रकाशित ड्राफ़्ट SIR रोल में शामिल",
    draftsirNotInRoll: "प्रकाशित ड्राफ़्ट SIR रोल में नहीं",
    draftsirMovedLabel: "क्या वे कहीं और मतदाता थे और हाल ही में यहाँ आए हैं?",
    xlsx: "Excel",
    liveBannerText: "नए अपडेट उपलब्ध हैं — ताज़ा करने के लिए टैप करें",
    unknownUser: "अज्ञात उपयोगकर्ता",
    deathCertPhoto: "मृत्यु प्रमाण पत्र फोटो",
    takePhoto: "फोटो जोड़ें",
    removePhoto: "फोटो हटाएं",
    photoUploaded: "फोटो जोड़ी गई।",
    teamTitle: "टीम",
    teamName: "नाम",
    teamEmail: "ईमेल",
    teamCoordinator: "भूमिका",
    teamLastActive: "अंतिम सक्रिय",
    teamMakeAdmin: "टीम समन्वयक बनाएं",
    teamRemoveAdmin: "टीम समन्वयक हटाएं",
    resetAllTitle: "समस्त फील्ड कार्य मिटाएँ",
    resetAllWarning:
      "यह हर रिकॉर्ड को अछूती स्थिति में लौटा देता है और फील्ड में दर्ज सारा काम हटा देता है। यह परीक्षण और वास्तविक प्रविष्टियों में अंतर नहीं कर सकता, और इसे पूर्ववत नहीं किया जा सकता। पहले डेटाबेस बैकअप लें।",
    resetAllVerifications: "हटाए जाने वाले सत्यापन",
    resetAllAdditions: "हटाई जाने वाली फील्ड प्रविष्टियाँ",
    resetAllRevisits: "हटाए जाने वाले पुनः भ्रमण चिह्न",
    resetAllHistory: "हटाई जाने वाली इतिहास प्रविष्टियाँ",
    resetAllPhotos: "हटाई जाने वाली मृत्यु प्रमाणपत्र तस्वीरें",
    resetAllKeeps: (n) => `${n} मतदाताओं की आयातित सूची प्रभावित नहीं होगी।`,
    resetAllTypeToConfirm: (phrase) => `पुष्टि के लिए ${phrase} टाइप करें`,
    resetAllButton: "समस्त फील्ड कार्य मिटाएँ",
    resetAllNothing: "मिटाने के लिए कोई दर्ज फील्ड कार्य नहीं है।",
    resetAllDone: (n) => `मिटा दिया गया। ${n} रिकॉर्ड अछूती स्थिति में लौटाए गए।`,
    teamAddCoordinator: "ईमेल से टीम समन्वयक जोड़ें",
    teamAddBtn: "जोड़ें",
    roleSuperAdmin: "सुपर एडमिन",
    roleCoordinator: "टीम समन्वयक",
    deleteEntry: "प्रविष्टि हटाएं",
    deleteEntryConfirmAddition:
      "इस प्रविष्टि को हटाएं? यह फील्ड में जोड़ी गई थी और मूल सूची में इसका कोई अस्तित्व नहीं है, इसलिए यह अपने पूरे इतिहास के साथ पूरी तरह हट जाएगी। इसे पूर्ववत नहीं किया जा सकता।",
    deleteEntryConfirmBaseRoll:
      "यह मतदाता मूल मतदाता सूची में है और इसे पूरी तरह हटाया नहीं जा सकता। इससे इसका सत्यापन 'शुरू नहीं हुआ' स्थिति में लौट जाएगा, और पहले से दर्ज कोई भी टिप्पणी, श्रेणी या फोटो हट जाएगी। इसे पूर्ववत नहीं किया जा सकता। जारी रखें?",
    nameModalTitle: "जारी रखने से पहले",
    nameModalBody:
      "इस ऐप में हर सत्यापन, जोड़ी गई प्रविष्टि और हटाई गई प्रविष्टि किसी नाम से जुड़ी होती है, ताकि टीम यह जान सके कि किसने क्या किया। वह नाम दर्ज करें जिससे आपके समन्वयक आपको जानते हैं।",
    nameModalLabel: "आपका नाम",
    nameModalPlaceholder: "जैसे प्रिया शर्मा",
    nameModalRequired: "जारी रखने के लिए अपना नाम दर्ज करें।",
    nameModalSubmit: "जारी रखें",
    logout: "लॉग आउट",
    exportsTitle: "डाउनलोड",
    exportFull: "पूरी सूची",
    exportAdditions: "जोड़े गए",
    exportDeletions: "हटाए गए",
    exportCorrections: "सुधार",
    exportNotFound: "नहीं मिले",
    csv: "CSV",
    zip: "ZIP (भाग अनुसार)",
    statusOffline: "ऑफ़लाइन",
    statusSyncing: "सिंक हो रहा है…",
    statusPending: (n) => `${n} लंबित`,
    searchNoteHouse: (n, base) => `मकान ${base} पर ${n} रिकॉर्ड मिले।`,
    searchNoteEpic: (n, base) => `EPIC नंबर ${base} के लिए ${n} रिकॉर्ड मिले।`,
    searchNoteName: (n, q) => `नाम ${q} से मिलते ${n} रिकॉर्ड, सबसे नज़दीकी मिलान पहले।`,
    searchNoteRelation: (n, q) =>
      `${q} नाम का कोई मतदाता नहीं है। ${n} मतदाता दिखाए जा रहे हैं जिनके पिता, पति या माता का नाम यह है।`,
    searchNoteLoose: (n, q) =>
      `${q} से पूरी तरह कुछ नहीं मिला। मकान नंबर या नाम पर ${n} अनुमानित मिलान दिखाए जा रहे हैं — ध्यान से जाँचें।`,
    searchNoteOfflineSuffix: " (इस डिवाइस की ऑफ़लाइन कॉपी से)",
  },
};

const RELATION_OPTS = ["father", "husband", "mother"];
const RELATION_KEY = { father: "optFather", husband: "optHusband", mother: "optMother" };
const GENDER_OPTS = ["Male", "Female"];
const GENDER_KEY = { Male: "optMale", Female: "optFemale" };
// Dashboard stat definitions are static descriptive text, translated here
// rather than server-side — the API stays English/data-only, matching how
// every other label in this app is translated on the client.
const DASH_DEFS = {
  en: {
    base_roll_total:
      'Total electors in the 2025 Final Roll (Revision 1) for Secunderabad Cantt (AC 71), parts 149-151 — <a href="https://voters.eci.gov.in/download-eroll?stateCode=S29" target="_blank" rel="noopener" onclick="event.stopPropagation()">voters.eci.gov.in</a>. Counted by unique EPIC.',
    verification_completed:
      "Voters a surveyor has recorded an outcome for, Found or Not Found. Counted by unique EPIC, like Base Roll Total.",
    additions: "Eligible voters found living in the area who are missing from the roll, recorded in the field.",
    deletions:
      "Voters who were verified and are marked for deletion, for reasons such as death, marriage, or other grounds recorded by the surveyor.",
    corrections: "Voters who were found but whose roll details are wrong, and who need a Form 8 correction.",
    not_found_shifted:
      "Voters present in the base roll but could not be found in the area due to them shifting residence / migrating out.",
    revised_total:
      "What the roll should contain once this audit is applied: base roll voters confirmed Found, plus field additions, minus deletions.",
    pending: "Voters still waiting to be verified (unique EPIC).",
  },
  hi: {
    base_roll_total:
      '2025 अंतिम नामावली (पुनरीक्षण 1), सिकंदराबाद छावनी (AC 71), भाग 149-151 में कुल निर्वाचक — <a href="https://voters.eci.gov.in/download-eroll?stateCode=S29" target="_blank" rel="noopener" onclick="event.stopPropagation()">voters.eci.gov.in</a>। अद्वितीय EPIC अनुसार गिने जाते हैं।',
    verification_completed: "वे मतदाता जिनके लिए सर्वेक्षक ने परिणाम (मिला या नहीं मिला) दर्ज किया है। मूल सूची कुल की तरह अद्वितीय EPIC अनुसार गिने जाते हैं।",
    additions: "क्षेत्र में रहते पाए गए वे पात्र मतदाता जो सूची में नहीं हैं, फील्ड में दर्ज किए गए।",
    deletions:
      "वे मतदाता जिनका सत्यापन हो गया है और जिन्हें हटाने के लिए चिह्नित किया गया है, जैसे मृत्यु, विवाह या अन्य कारणों से।",
    corrections: "मिले हुए मतदाता जिनकी सूची जानकारी गलत है और जिन्हें फॉर्म 8 सुधार चाहिए।",
    not_found_shifted:
      "मूल सूची में मौजूद मतदाता जो निवास स्थानांतरित / पलायन कर जाने के कारण क्षेत्र में नहीं मिल सके।",
    revised_total: "ऑडिट लागू होने के बाद सूची में क्या होना चाहिए: मूल सूची में मिले मतदाता + फील्ड में जोड़े गए − हटाए गए।",
    pending: "अभी भी सत्यापन की प्रतीक्षा में मतदाता (अद्वितीय EPIC)।",
  },
};

function dashDef(key) {
  return DASH_DEFS[lang][key] || DASH_DEFS.en[key] || "";
}

function t(key) {
  const v = I18N[lang][key] ?? I18N.en[key] ?? key;
  return v;
}

function setLang(l) {
  lang = l;
  localStorage.setItem("lang", l);
  applyStaticText();
  if (publicMode) {
    import("./public-dashboard.js").then((m) => m.setPublicLang(l));
    return;
  }
  renderResults();
  if (window.okhla && window.okhla.rerender) window.okhla.rerender();
}

function applyStaticText() {
  document.documentElement.lang = lang;
  document.getElementById("t-title").textContent = t("title");
  document.getElementById("t-sub").textContent = t("sub");
  document.getElementById("t-searchBtn").textContent = t("searchBtn");
  document.getElementById("t-addBtn").textContent = t("addBtn");
  document.getElementById("searchInput").placeholder = t("searchPlaceholder");
  document.getElementById("lang-en").classList.toggle("active", lang === "en");
  document.getElementById("lang-hi").classList.toggle("active", lang === "hi");
  document.getElementById("tab-search").textContent = t("tabSearch");
  document.getElementById("tab-dashboard").textContent = t("tabDashboard");
  document.getElementById("tab-team").textContent = t("tabTeam");
  document.getElementById("tab-monthly-pooling").textContent = t("tabMonthlyPooling");
  document.getElementById("tab-asddo").textContent = t("tabAsddo");
  document.getElementById("tab-draftsir").textContent = t("tabDraftsir");
  document.getElementById("tab-reverify").textContent = t("tabReverify");
  document.getElementById("tab-search-all").textContent = t("tabSearchAll");
  document.getElementById("tab-ph-followup").textContent = t("tabPhFollowup");
  document.getElementById("t-liveBannerText").textContent = t("liveBannerText");
}

/* -------------------------------------------------------- toast + modal */

// A brief flash notification, replacing the old "Saved." text that sat next
// to the submit button. That text was easy to miss — especially in the
// Addition form, where missing it was leading surveyors to press Save a
// second time, creating duplicate entries. A message that appears in the
// middle of the screen and needs no action is much harder to miss or
// mis-time a second tap around. Nothing here requires the surveyor to do
// anything; it disappears on its own.
function showToast(message, opts = {}) {
  const host = document.getElementById("toastHost");
  if (!host || !message) return;
  const el = document.createElement("div");
  el.className = "toast" + (opts.variant ? ` ${opts.variant}` : "");
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, 1800);
}

// In-app replacement for window.confirm(). Some installed-PWA browser
// contexts on Android silently no-op native confirm()/alert() dialogs —
// indistinguishable from a button that "does nothing" — which is the most
// likely explanation for reports that the old reset button did not work.
// This also lets the confirmation text vary by what is actually about to
// happen (a base-roll voter can only ever be reset, never truly deleted).
function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const host = document.getElementById("modalHost");
    const card = document.getElementById("modalCard");
    card.innerHTML = `
      <p style="margin:0 0 16px;line-height:1.5;">${message}</p>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="secondary" id="modal-cancel">${t("cancel")}</button>
        <button class="${opts.danger ? "danger" : ""}" id="modal-ok">${opts.okLabel || t("save")}</button>
      </div>
    `;
    host.style.display = "flex";
    const close = (result) => {
      host.style.display = "none";
      resolve(result);
    };
    document.getElementById("modal-cancel").onclick = () => close(false);
    document.getElementById("modal-ok").onclick = () => close(true);
  });
}

// The one-time name prompt (item #10). Deliberately has no cancel and no
// backdrop dismissal — accountability for verifications/additions/deletions
// depends on every account having a name on file, so this cannot be skipped.
// It only ever appears once per account: requestNameIfMissing() below does
// not call this again once the server confirms a name is on file.
function promptForName() {
  return new Promise((resolve) => {
    const host = document.getElementById("modalHost");
    const card = document.getElementById("modalCard");
    card.innerHTML = `
      <div class="section-title" style="margin-top:0">${t("nameModalTitle")}</div>
      <p style="margin:0 0 16px; color:var(--ink-muted); font-size:13px; line-height:1.5;">${t("nameModalBody")}</p>
      <span class="field-label">${t("nameModalLabel")}</span>
      <input id="name-modal-input" placeholder="${t("nameModalPlaceholder")}" autocomplete="name" />
      <div class="field-hint" id="name-modal-error" style="display:none">${t("nameModalRequired")}</div>
      <div style="margin-top:16px; text-align:right;">
        <button id="name-modal-submit">${t("nameModalSubmit")}</button>
      </div>
    `;
    host.style.display = "flex";
    const input = document.getElementById("name-modal-input");
    const err = document.getElementById("name-modal-error");
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        err.style.display = "";
        input.focus();
        return;
      }
      host.style.display = "none";
      resolve(v);
    };
    document.getElementById("name-modal-submit").onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    setTimeout(() => input.focus(), 50);
  });
}

// Runs once at boot. Asks for a name only when the server confirms none is
// on file yet — so this fires exactly once per account, the first time that
// account boots the app after this feature shipped, regardless of how long
// the account has already been in use.
async function requestNameIfMissing() {
  if (!currentUserEmail || currentUserName) return;
  if (!navigator.onLine) return; // can't submit; ask again next boot online
  const name = await promptForName();
  try {
    await api.setMyName(name);
    currentUserName = name;
    directory[currentUserEmail] = name;
    loadWhoami();
  } catch (err) {
    // Transient failure — ask again next boot rather than blocking
    // fieldwork on it now.
  }
}

/* ------------------------------------------------------------- identity */

async function loadWhoami() {
  try {
    const d = await api.whoami();
    currentUserEmail = d.email;
    currentUserName = d.name || null;
    if (currentUserEmail && currentUserName) directory[currentUserEmail] = currentUserName;
    isAdmin = !!d.is_admin;
    isSuperAdmin = !!d.is_super_admin;
    // Team tab hidden for now (owner request, 2026-09-04) — was admin-only visible;
    // the admin-visibility logic stays in isAdmin, just not wired to this button.
    document.getElementById("tab-team").style.display = "none";
    const canSeeDashboards = DASHBOARD_RESTRICTED_TO.includes((currentUserEmail || "").toLowerCase());
    document.getElementById("tab-dashboard").style.display = canSeeDashboards ? "" : "none";
    document.getElementById("tab-reverify").style.display = canSeeDashboards ? "" : "none";
    window.currentUserEmail = currentUserEmail;

    const identityEl = document.getElementById("userIdentity");
    if (currentUserEmail) {
      identityEl.style.display = "";
      identityEl.innerHTML = `<span>${staffLabel(currentUserEmail)}</span><a href="/cdn-cgi/access/logout">${t("logout")}</a>`;
    } else {
      identityEl.style.display = "none";
    }
  } catch (e) {}
}

// Dropdown option lists the server defines, so they only exist in one place.
// Kept in English regardless of UI language — these are formal ECI category
// names (matching how "Form 6"/"Form 8" already stay untranslated) and
// mistranslating an official term is worse than leaving it in English.
let appConfig = {
  addition_categories: [],
  correction_types: [],
  yes_no: ["Yes", "No"],
};

async function loadConfig() {
  try {
    appConfig = await api.config();
  } catch (e) {}
}

/* ---------------------------------------------------------------- areas */

// Top-level split of the staff app. At login neither area is open: only the
// Mangolpuri / Okhla buttons show. Clicking Mangolpuri reveals the original
// layout and all of its tabs (showTab below works inside it); Okhla has its own
// panel. showArea(null) returns to the bare two-button state.
let mangolpuriStarted = false;

function showArea(name) {
  for (const area of ["mangolpuri", "okhla"]) {
    const on = area === name;
    document.getElementById(`area-${area}`).classList.toggle("active", on);
    document.getElementById(`area${area[0].toUpperCase()}${area.slice(1)}`).style.display = on ? "" : "none";
  }
  // Load the Mangolpuri tabs only when first opened — nothing in it is visible before.
  if (name === "mangolpuri" && !mangolpuriStarted) {
    mangolpuriStarted = true;
    showTab(currentTab);
  }
  if (name === "okhla") {
    import("./okhla-tab.js").then((m) => m.initOkhla({ t, escapeHtml, showToast, staffLabel, fmtDateTime, confirmDialog }));
  }
}

/* ----------------------------------------------------------------- tabs */

let currentTab = "phFollowup";

const TAB_BUTTON_ID = {
  phFollowup: "tab-ph-followup",
  searchAll: "tab-search-all",
  asddo: "tab-asddo",
  draftsir: "tab-draftsir",
  reverify: "tab-reverify",
  search: "tab-search",
  dashboard: "tab-dashboard",
  team: "tab-team",
  monthlyPooling: "tab-monthly-pooling",
};

function showTab(name) {
  currentTab = name;
  for (const tabName of Object.keys(TAB_BUTTON_ID)) {
    document.getElementById(TAB_BUTTON_ID[tabName]).classList.toggle("active", name === tabName);
    document.getElementById(`${tabName}View`).style.display = name === tabName ? "" : "none";
  }
  if (name === "dashboard") loadDashboard();
  if (name === "team") loadTeam();
  if (name === "monthlyPooling") loadMonthlyPooling();
  if (name === "reverify") {
    import("./reverify-dashboard.js").then((m) =>
      m.initReverify({ t, showToast, escapeHtml, staffLabel, fmtDateTime })
    );
  }
  if (name === "asddo") {
    import("./asddo-list.js").then((m) =>
      m.initAsddoList({ t, showToast, escapeHtml, staffLabel, fmtDateTime })
    );
  }
  if (name === "draftsir") {
    import("./draftsir-list.js").then((m) =>
      m.initDraftsirList({ t, showToast, escapeHtml, staffLabel, fmtDateTime })
    );
  }
  if (name === "searchAll") {
    import("./search-all.js").then((m) =>
      m.initSearchAll({ t, showToast, escapeHtml, staffLabel, fmtDateTime })
    );
  }
  if (name === "phFollowup") {
    import("./ph-followup-tab.js").then((m) =>
      m.initPhFollowup({ t, showToast, escapeHtml, staffLabel, fmtDateTime })
    );
  }
}

// Called by a worklist tab's "other flags at this house" strip to hand off to
// the sibling list: open that tab, make sure its module is initialised, then
// navigate to the one voter with its form open.
async function jumpToWorklistVoter(list, tile, id) {
  showTab(list);
  const m = await import(list === "asddo" ? "./asddo-list.js" : "./draftsir-list.js");
  (list === "asddo" ? m.initAsddoList : m.initDraftsirList)({
    t,
    showToast,
    escapeHtml,
    staffLabel,
    fmtDateTime,
  });
  const g = window[list === "asddo" ? "asddoList" : "draftsirList"];
  if (g && g.goToVoter) g.goToVoter(tile, id);
}

// A landing screen for the two Feb 2025 - Jun 2026 official roll update
// categories, rather than two separate top-level tabs crowding the tab bar.
// Both lists carry no house number (the update file had no address column
// at all), so this is the only way to find and complete them.
function loadMonthlyPooling() {
  const el = document.getElementById("monthlyPoolingView");
  el.innerHTML = `
    <div class="card">
      <div class="section-title">${t("tabMonthlyPooling")}</div>
      <div class="row">
        <div>
          <span class="toggle-link" onclick="app.showMonthlyPoolingAdditions()">${t("tabSourceUpdate")}</span>
        </div>
      </div>
      <div class="row">
        <div>
          <span class="toggle-link" onclick="app.showMonthlyPoolingUnidentifiedDeletions()">${t("tabUnidentifiedDeletions")}</span>
        </div>
      </div>
      <div class="meta" style="margin-top:var(--sp-3)">${t("monthlyPoolingSource")}</div>
    </div>
  `;
}

// Reuses the same drill-down list every dashboard stat already opens
// (search-tab card list, Edit details / Verify / Delete all just work),
// rather than a second parallel results renderer. The Monthly Pooling tab
// stays highlighted as active while browsing either list — clicking it
// again in the tab bar returns to the chooser above.
async function showMonthlyPoolingAdditions() {
  await drillDown("source_roll_update_additions");
  document.getElementById("tab-search").classList.remove("active");
  document.getElementById("tab-monthly-pooling").classList.add("active");
}

async function showMonthlyPoolingUnidentifiedDeletions() {
  await drillDown("unidentified_deletions");
  document.getElementById("tab-search").classList.remove("active");
  document.getElementById("tab-monthly-pooling").classList.add("active");
}

async function refreshCurrentView() {
  document.getElementById("liveBanner").classList.remove("show");
  if (currentTab === "search") {
    const q = document.getElementById("searchInput").value.trim();
    if (q) await doSearch();
  } else if (currentTab === "dashboard") {
    await loadDashboard();
  } else if (currentTab === "team") {
    await loadTeam();
  }
}

/* --------------------------------------------------------------- search */

document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});


let lastSearch = {};

async function doSearch() {
  const q = document.getElementById("searchInput").value.trim();
  if (!q) return;
  document.getElementById("drillContext").style.display = "none";
  const out = await api.search(q);
  currentResults = out.results || [];
  lastSearch = {
    matchType: out.match_type,
    queryBase: out.query_base,
    query: q,
    offline: !!out.offline,
  };
  renderResults();
}

function badgeHtml(e) {
  let out = "";
  const s = e.verification_status;
  if (s === "Found") out += `<span class="badge found">${t("badgeFound")}</span>`;
  else if (s === "Not Found") out += `<span class="badge notfound">${t("badgeNotFound")}</span>`;
  else out += `<span class="badge pending">${t("badgeNotStarted")}</span>`;
  if (e.is_duplicate_epic) out += `<span class="badge dup">${t("badgeDupEpic")}</span>`;
  // The month/year suffix is the CSV's own Month/Year for this event, shown
  // as-is rather than reformatted — only present when the tag came from the
  // Feb 2025 - Jun 2026 roll update import, so a pre-existing deletion from
  // the original roll import shows no date at all.
  if (e.source_deleted === "Yes") {
    out += `<span class="badge del">${t("badgeDeletedSource")}${e.source_deleted_month ? ": " + e.source_deleted_month : ""}</span>`;
  }
  if (e.source_modified === "Yes") out += `<span class="badge type">${t("badgeModifiedSource")}</span>`;
  if (e.source_added_update === "Yes") {
    out += `<span class="badge type">${t("badgeSourceRollAddition")}${e.source_added_update_month ? ": " + e.source_added_update_month : ""}</span>`;
  }
  if (e.source_unidentified_deletion === "Yes") {
    out += `<span class="badge del">${t("badgeUnidentifiedDeletion")}${e.source_unidentified_deletion_month ? ": " + e.source_unidentified_deletion_month : ""}</span>`;
  }
  // Supplement 5 (ECI) — additions / deletions / corrections the owner
  // identified as missed from the base roll. Shown on the card so a ground
  // verifier searching by house / EPIC / name sees the status at the door.
  if (e.supplement5 === "Deletion") out += `<span class="badge del">${t("badgeS5Deleted")}</span>`;
  if (e.supplement5 === "Addition") out += `<span class="badge type">${t("badgeS5Added")}</span>`;
  if (e.supplement5 === "Correction") out += `<span class="badge type">${t("badgeS5Correction")}</span>`;
  if (e.added_in_field) out += `<span class="badge found">${t("badgeAddedField")}</span>`;
  for (const flag of e.flags || []) out += `<span class="badge dup">${valueLabel(flag)}</span>`;
  // What kind of addition/deletion/correction this is, so a drill-down list
  // (or any search result) shows the category on the card itself rather than
  // only inside the expanded form. `type` reuses the navy-tint styling the
  // design system reserves for informational tags, distinct from the
  // found/warning/danger colours used for verification state above.
  if (e.added_in_field && e.addition_category) {
    out += `<span class="badge type">${t("badgeAdditionType")}: ${valueLabel(e.addition_category)}</span>`;
  }
  if (e.sub_category === "Deletion" && e.deletion_type) {
    out += `<span class="badge type">${t("badgeDeletionType")}: ${deletionTypeLabel(e.deletion_type)}</span>`;
  }
  if (e.sub_category === "Correction needed" && e.correction_type) {
    out += `<span class="badge type">${t("badgeCorrectionType")}: ${valueLabel(e.correction_type)}</span>`;
  }
  // No grace period any more — a submitted record is simply locked until
  // someone clicks Reopen, regardless of who or when, so the badge just
  // mirrors locked_at directly.
  if (e.locked_at) out += `<span class="badge locked">${t("badgeLocked")}</span>`;
  if (e.pending_sync) out += `<span class="badge offline">${t("badgePendingSync")}</span>`;
  return out;
}

// "Verified by NAME · 18 Aug 2026, 3:40 pm" (or "Added by" for a field
// addition) — who touched this record last, and when. Nothing renders for an
// untouched (Not Started) base-roll record, since there is no one to name yet.
function attributionLine(e) {
  if (e.added_in_field) {
    return `<div class="meta">${t("metaAddedBy")}: ${staffLabel(e.verified_by)}${e.verified_at ? " &middot; " + fmtDateTime(e.verified_at) : ""}</div>`;
  }
  if (e.verification_status && e.verification_status !== "Not Started") {
    return `<div class="meta">${t("metaVerifiedBy")}: ${staffLabel(e.verified_by)}${e.verified_at ? " &middot; " + fmtDateTime(e.verified_at) : ""}</div>`;
  }
  return "";
}

/* Display labels for values that are stored in English.
 *
 * Every list the API knows about — addition categories, correction
 * sub-categories, deletion types, the roll's own flag tags — travels and is
 * stored in English, because the backend is English/data-only. Only what the
 * surveyor reads is translated, and only here.
 *
 * A value with no entry renders as itself rather than vanishing. Showing an
 * untranslated tag is always better than silently hiding something the roll
 * says about a voter.
 *
 * Adding a value to one of these lists in src/records.ts means adding it here
 * too, or it will show in English to a Hindi user.
 */
const VALUE_LABEL_KEY = {
  // Addition categories (Form 6)
  "Completed 18 years": "optCat18",
  Marriage: "optCatMarriage",
  "Wrongful Deletion": "optCatWrongful",
  "Voter not found in base roll": "optCatNotInBaseRoll",
  Other: "optCatOther",
  // Correction sub-categories (Form 8)
  "Correction of Entries in Existing Electoral Roll": "optCorrEntries",
  "Shifting of Residence": "optCorrShifting",
  // Deletion types
  Death: "optTypeDeath",
  "Absent / Permanently shifted": "optTypeAbsent",
  "Duplicate Voter": "optTypeDuplicateVoter",
  // Source-roll flag tags
  Absent: "flagAbsent",
  Expired: "flagExpired",
  Repeated: "flagRepeated",
  Shifted: "flagShifted",
};

function valueLabel(value) {
  const key = VALUE_LABEL_KEY[value];
  return key ? t(key) : value || "";
}

// email -> display name, from GET /api/directory. Populated at boot
// (loadDirectory()) and refreshed whenever the Team tab loads. Starts empty
// for a deploy that has never run the name-capture flow, in which case
// staffLabel() below falls back to the email — exactly the "for now, emails;
// names as people log in" transition the owner asked for.
let directory = {};

// A free-text name someone typed about themselves is about to be shown to
// every other signed-in person on every card that mentions them — this is
// the one piece of user-authored text in the whole app that reaches other
// users' screens verbatim, so it is the one place HTML must be escaped
// before it goes into innerHTML. Voter names/notes from the roll are typed
// by vetted survey staff already and are not addressed here.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

// currentUser() falls back to the literal string "unknown" when no Cloudflare
// Access header is present. That sentinel should never reach a surveyor's
// screen untranslated — in production it means the header was missing, which
// is worth showing plainly rather than as an English word in a Hindi UI.
//
// Prefers the person's name over their email wherever one is on file — this
// is the single choke point every "Verified by" / "Added by" / Team-tab name
// display goes through, so it is also the single place that needs to escape
// user-authored text (see escapeHtml above).
function staffLabel(email) {
  if (!email) return "-";
  if (email === "unknown") return t("unknownUser");
  return directory[email] ? escapeHtml(directory[email]) : email;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" });
}

async function loadDirectory() {
  try {
    directory = await api.directory();
  } catch (e) {}
}

// Kept as a named alias so the deletion-type call sites read clearly.
const deletionTypeLabel = valueLabel;

function relationLabel(value) {
  const key = RELATION_KEY[value];
  return key ? t(key) : value || "";
}

// "Father: RAM LAL" in both languages, never "father of RAM LAL".
//
// The roll's relation columns name the elector's *relative*, not the elector:
// relation_type "Husband" + relation_name "MOTI LAL" means her husband is
// Moti Lal — i.e. she is his wife. The old English phrasing ("husband of MOTI
// LAL") asserted the exact opposite and mislabelled every spouse and child on
// the roll. Hindi was always correct because it used the colon form; English
// now matches it. Don't "fix" this back into a natural-sounding phrase — the
// colon is doing real work.
// Some roll entries carry no relation at all (Moti Lal, part 125 sr. 150, is
// one). Return empty for those so the caller can drop the segment rather than
// print a bare ": -".
function relationLine(e) {
  const rel = relationLabel(e.relation_type);
  const relName = e.relation_name || "";
  if (!rel && !relName) return "";
  if (!rel) return relName;
  return `${rel}: ${relName || "-"}`;
}

function searchNoteHtml() {
  const { matchType, queryBase, query, offline } = lastSearch;
  const n = currentResults.length;
  const suffix = offline ? t("searchNoteOfflineSuffix") : "";
  let text = "";
  if (matchType === "house") text = t("searchNoteHouse")(n, queryBase);
  else if (matchType === "epic") text = t("searchNoteEpic")(n, queryBase);
  else if (matchType === "name") text = t("searchNoteName")(n, query);
  else if (matchType === "relation") text = t("searchNoteRelation")(n, query);
  else if (matchType === "loose") text = t("searchNoteLoose")(n, query);
  else return "";
  return `<div class="meta" style="margin-bottom:10px">${text}${suffix}</div>`;
}

function renderResults() {
  const el = document.getElementById("results");
  if (!currentResults.length) {
    el.innerHTML = `<div class="empty">${t("noMatches")}</div>`;
    return;
  }
  el.innerHTML =
    searchNoteHtml() +
    currentResults
      .map(
        (e) => `
    <div class="card" id="card-${e.id}">
      <div class="top">
        <div>
          <div class="name">${e.name}</div>
          <div class="meta">${[relationLine(e), `${e.age || "?"} ${t("yrs")}`, e.gender === "Male" ? t("optMale") : e.gender === "Female" ? t("optFemale") : e.gender || "-"].filter(Boolean).join(" &middot; ")}</div>
          <div class="meta">${t("metaHouse")} ${e.house_number_raw} &middot; ${t("metaEpic")} ${e.epic_id || "-"} &middot; ${t("metaPart")} ${e.part_number} &middot; ${t("metaSrNo")} ${e.sr_no || "-"}</div>
          ${attributionLine(e)}
          <div class="badges">${badgeHtml(e)}</div>
        </div>
        <div>
          <span class="toggle-link" onclick="app.toggleExpand(${e.id})">${t("verifyBtn")}</span>
          ${
            // Immediately visible next to Verify, same as Edit details/Delete
            // entry below — not hidden behind an extra click into the Verify
            // panel to discover it. Anyone signed in sees this on any locked
            // record, matching the rest of this feature (2026-08-25).
            e.locked_at
              ? `<span class="toggle-link" onclick="app.reopen(${e.id})">${t("reopen")}</span>`
              : ""
          }
          ${isSuperAdmin ? `<span class="flag-link" onclick="app.showEditDetails(${e.id})">${t("editDetails")}</span>` : ""}
        </div>
      </div>
      <div class="expand" id="expand-${e.id}">
        ${statusFormHtml(e)}
      </div>
      <div class="expand" id="editdetails-${e.id}"></div>
      ${
        // Deliberately its own row, separated by a rule, rather than sitting
        // next to Verify/Edit details — a destructive action reads as an
        // accident waiting to happen when it's one misplaced tap away from
        // routine ones. Super admin-only as of 2026-08-25 (tightened back
        // from any admin) — see the permission note on POST
        // /elector/:id/reset in src/index.ts.
        isSuperAdmin
          ? `<div class="card-footer"><span class="delete-link" onclick="app.deleteEntryAction(${e.id})">${t("deleteEntry")}</span></div>`
          : ""
      }
    </div>
  `
      )
      .join("");
  // statusFormHtml() only pre-selects the top-level verification status —
  // the sub-category detail below it (correction/deletion type, the phone
  // number that goes with it, a death-cert photo) is built by
  // renderSubCategory() and its cascade, which otherwise only ever run on
  // an onchange. Without this, opening "Verify" on an already-verified or
  // field-added record showed an empty sub-form the admin had to
  // reconstruct from memory instead of the data actually on file. Runs for
  // every card, not just expanded ones — the form exists in the DOM either
  // way, just hidden by CSS, and pre-filling it now means it's already
  // correct the moment someone opens it. No-ops for a card that's still
  // showing the Reopen button instead of the form (renderSubCategory()
  // guards on that).
  currentResults.forEach((e) => renderSubCategory(e.id));
}

function showEditDetails(id) {
  const wrap = document.getElementById(`editdetails-${id}`);
  const isOpen = wrap.classList.contains("open");
  document.querySelectorAll(".expand").forEach((el) => {
    if (el.id !== `editdetails-${id}`) el.classList.remove("open");
  });
  if (isOpen) {
    wrap.classList.remove("open");
    return;
  }
  const e = currentResults.find((x) => x.id === id) || {};
  wrap.classList.add("open");
  wrap.innerHTML = `
    <div class="row">
      <div>
        <span class="field-label">${t("name")}</span>
        <input id="ed-name-${id}" value="${e.name || ""}" />
      </div>
      <div>
        <span class="field-label">${t("partNumber")}</span>
        <input id="ed-part-${id}" value="${e.part_number || ""}" />
      </div>
    </div>
    <div class="row">
      <div>
        <span class="field-label">${t("houseNumber")}</span>
        <input id="ed-house-${id}" value="${e.house_number_raw || ""}" />
      </div>
      <div>
        <span class="field-label">${t("age")}</span>
        <input id="ed-age-${id}" value="${e.age || ""}" />
      </div>
    </div>
    <div class="row">
      <div>
        <span class="field-label">${t("gender")}</span>
        <select id="ed-gender-${id}">
          ${GENDER_OPTS.map((v) => `<option value="${v}" ${e.gender === v ? "selected" : ""}>${t(GENDER_KEY[v])}</option>`).join("")}
        </select>
      </div>
      <div>
        <span class="field-label">${t("contactPhone")}</span>
        <input id="ed-phone-${id}" value="${e.contact_phone || ""}" />
      </div>
    </div>
    <div class="row">
      <div>
        <span class="field-label">${t("relationType")}</span>
        <select id="ed-reltype-${id}">
          <option value="">${t("optDash")}</option>
          ${RELATION_OPTS.map((v) => `<option value="${v}" ${e.relation_type === v ? "selected" : ""}>${relationLabel(v)}</option>`).join("")}
        </select>
      </div>
      <div>
        <span class="field-label">${t("relationName")}</span>
        <input id="ed-relname-${id}" value="${e.relation_name || ""}" />
      </div>
    </div>
    <button id="ed-save-${id}" onclick="app.submitEditDetails(${id})">${t("save")}</button>
    <span class="save-msg" id="ed-saved-${id}"></span>
  `;
}

async function submitEditDetails(id) {
  const btn = document.getElementById(`ed-save-${id}`);
  if (btn.disabled) return; // guards a literal double-click/double-tap
  btn.disabled = true;
  const payload = {
    name: document.getElementById(`ed-name-${id}`).value,
    part_number: document.getElementById(`ed-part-${id}`).value,
    house_number_raw: document.getElementById(`ed-house-${id}`).value,
    age: document.getElementById(`ed-age-${id}`).value,
    gender: document.getElementById(`ed-gender-${id}`).value,
    contact_phone: document.getElementById(`ed-phone-${id}`).value,
    relation_type: document.getElementById(`ed-reltype-${id}`).value,
    relation_name: document.getElementById(`ed-relname-${id}`).value,
  };
  try {
    const record = await api.updateDetails(id, payload);
    currentResults = currentResults.map((e) => (e.id === id ? record : e));
    renderResults();
    document.getElementById(`editdetails-${id}`).classList.add("open");
    showToast(t("saved"), { variant: "success" });
  } catch (err) {
    const msg = document.getElementById(`ed-saved-${id}`);
    if (msg) msg.textContent = err.message || t("errorSaving");
    btn.disabled = false;
  }
}

// "Delete entry" — open to any admin (Team Coordinator or Super Admin). A
// field addition is removed outright, since it has no existence on the base
// roll; a base-roll voter can never be truly deleted (that would corrupt the
// imported roll) and is instead reset to untouched. The wording shown to the
// admin differs accordingly, via confirmDialog() rather than the browser's
// native confirm() — some installed-PWA contexts silently no-op
// window.confirm(), which is the most likely reason this used to look like
// it "did nothing" when tapped.
//
// (This function previously lived further down the file, inside the block
// removed wholesale when the Revisits feature was deleted (2026-08-18) — it
// got caught by that deletion along with everything else in that region.
// Moved here, next to the other card-action handlers, so it can't happen
// again by the same mistake.)
async function deleteEntryAction(id) {
  const e = currentResults.find((x) => x.id === id);
  const message = e && e.added_in_field ? t("deleteEntryConfirmAddition") : t("deleteEntryConfirmBaseRoll");
  const ok = await confirmDialog(message, { danger: true, okLabel: t("deleteEntry") });
  if (!ok) return;
  try {
    const result = await api.resetRecord(id);
    if (result.deleted) {
      currentResults = currentResults.filter((x) => x.id !== id);
    } else if (e) {
      Object.assign(e, result);
    }
    renderResults();
    showToast(t("saved"), { variant: "success" });
  } catch (err) {
    showToast(err.message || t("errorSaving"), { variant: "error" });
  }
}

function toggleExpand(id) {
  document.getElementById(`expand-${id}`).classList.toggle("open");
}

// No grace period, no role check (2026-08-25): a submitted record is simply
// locked until someone clicks Reopen — anyone signed in can. Reopening
// clears the lock (setLock on the backend), so the next render shows the
// full form below instead of this button.
function statusFormHtml(e) {
  if (e.locked_at) {
    return `<button onclick="app.reopen(${e.id})">${t("reopen")}</button>`;
  }
  return `
    <div class="row">
      <div>
        <span class="field-label">${t("verificationStatus")}</span>
        <select id="status-${e.id}" onchange="app.renderSubCategory(${e.id})">
          ${
            // "Not Started" is no longer offered as a choice, but it is still
            // the stored state of every untouched record. Without a
            // placeholder holding the initial selection the browser would
            // pre-select "Found", and a surveyor who saved without touching
            // the dropdown would silently mark a voter Found. The blank is
            // disabled so it cannot be chosen again, and saveStatus() refuses
            // to submit while it is selected.
            e.verification_status === "Not Started"
              ? `<option value="" disabled selected>${t("optDash")}</option>`
              : ""
          }
          <option value="Found" ${e.verification_status === "Found" ? "selected" : ""}>${t("optFound")}</option>
          <option value="Not Found" ${e.verification_status === "Not Found" ? "selected" : ""}>${t("optNotFound")}</option>
        </select>
      </div>
      <div>
        <span class="field-label">${t("verifiedBy")}</span>
        <input id="vb-${e.id}" value="${currentUserEmail || e.verified_by || ""}" placeholder="${t("staffName")}" readonly />
      </div>
    </div>
    <div id="subcat-${e.id}"></div>
    <div class="row">
      <div>
        <span class="field-label">${t("notes")}</span>
        <textarea id="notes-${e.id}" rows="2" style="width:100%">${e.notes || ""}</textarea>
      </div>
    </div>
    <button id="save-status-btn-${e.id}" onclick="app.saveStatus(${e.id})">${t("save")}</button>
    <span class="save-msg" id="saved-${e.id}"></span>
  `;
}

function renderSubCategory(id) {
  const statusEl = document.getElementById(`status-${id}`);
  // Absent whenever the card is still showing the Reopen button instead of
  // the full form (statusFormHtml) — nothing to populate in that case.
  if (!statusEl) return;
  const status = statusEl.value;
  const wrap = document.getElementById(`subcat-${id}`);
  const e = currentResults.find((x) => x.id === id) || {};
  if (status === "Found") {
    wrap.innerHTML = `
      <div class="row">
        <div>
          <span class="field-label">${t("subCategory")}</span>
          <select id="subcat-select-${id}" onchange="app.renderFoundExtras(${id})">
            <option value="All Information Correct">${t("optAllInfoCorrect")}</option>
            <option value="Deletion">${t("optDeletion")}</option>
            <option value="Correction needed">${t("optCorrectionNeeded")}</option>
          </select>
        </div>
      </div>
      <div id="found-extra-${id}"></div>
    `;
    setTimeout(() => {
      // The card can have re-rendered (a rapid second drill-down/filter
      // click, in practice) before this fires — nothing to populate if so.
      const sel = document.getElementById(`subcat-select-${id}`);
      if (!sel) return;
      if (e.sub_category) sel.value = e.sub_category;
      renderFoundExtras(id);
    }, 0);
  } else if (status === "Not Found") {
    wrap.innerHTML = `
      <div class="row">
        <div>
          <span class="field-label">${t("subCategory")}</span>
          <select id="subcat-select-${id}">
            <option value="Migrated">${t("optMigrated")}</option>
            <option value="Others">${t("optOthers")}</option>
          </select>
        </div>
      </div>
    `;
    setTimeout(() => {
      const sel = document.getElementById(`subcat-select-${id}`);
      if (!sel) return;
      if (e.sub_category) sel.value = e.sub_category;
    }, 0);
  } else {
    wrap.innerHTML = "";
  }
}

function renderFoundExtras(id) {
  const sub = document.getElementById(`subcat-select-${id}`).value;
  const extra = document.getElementById(`found-extra-${id}`);
  const e = currentResults.find((x) => x.id === id) || {};
  if (sub === "Deletion") {
    // The certificate field is rendered separately by renderDeletionExtras()
    // so that changing the type can show or hide it without rebuilding — and
    // without discarding a photo the surveyor has already attached.
    extra.innerHTML = `
      <div class="row">
        <div>
          <span class="field-label">${t("deletionType")}</span>
          <select id="deletiontype-${id}" onchange="app.renderDeletionExtras(${id})">
            ${
              // Disabled once a real type is chosen — a blank left selected
              // silently saved as no type at all until saveStatus() started
              // refusing to submit while it is selected (2026-08-26). Same
              // pattern as the Found/Not Found placeholder above.
              !e.deletion_type ? `<option value="" disabled selected>${t("optDash")}</option>` : ""
            }
            ${(appConfig.deletion_types || [])
              .map((v) => `<option value="${v}" ${e.deletion_type === v ? "selected" : ""}>${deletionTypeLabel(v)}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div id="deletion-extra-${id}"></div>
    `;
    renderDeletionExtras(id);
  } else if (sub === "Correction needed") {
    // The phone field lives in its own container so changing the sub-category
    // can mark it required without rebuilding the select and losing focus.
    extra.innerHTML = `
      <div class="row">
        <div>
          <span class="field-label">${t("correctionSubCategory")}</span>
          <select id="correctiontype-${id}" onchange="app.renderCorrectionExtras(${id})">
            ${!e.correction_type ? `<option value="" disabled selected>${t("optDash")}</option>` : ""}
            ${appConfig.correction_types
              .map((v) => `<option value="${v}" ${e.correction_type === v ? "selected" : ""}>${valueLabel(v)}</option>`)
              .join("")}
          </select>
        </div>
        <div id="correction-phone-${id}"></div>
      </div>
    `;
    renderCorrectionExtras(id);
  } else {
    extra.innerHTML = "";
  }
}

const pendingPhotos = {}; // elector id -> base64 data URL, staged until Save
const removedPhotos = new Set();

async function saveStatus(id) {
  const btn = document.getElementById(`save-status-btn-${id}`);
  if (btn && btn.disabled) return; // guards a literal double-click/double-tap
  const status = document.getElementById(`status-${id}`).value;
  // Guards the placeholder described in statusFormHtml(): saving an untouched
  // record without picking an outcome must not write anything.
  if (!status) {
    const msg = document.getElementById(`saved-${id}`);
    msg.className = "save-msg error";
    msg.textContent = t("chooseStatus");
    return;
  }
  const subSelect = document.getElementById(`subcat-select-${id}`);
  const payload = {
    verification_status: status,
    sub_category: subSelect ? subSelect.value : null,
    notes: document.getElementById(`notes-${id}`).value || null,
  };
  const correctionTypeEl = document.getElementById(`correctiontype-${id}`);
  if (correctionTypeEl) payload.correction_type = correctionTypeEl.value || null;
  const deletionTypeEl = document.getElementById(`deletiontype-${id}`);
  if (deletionTypeEl) payload.deletion_type = deletionTypeEl.value || null;
  const contactPhoneEl = document.getElementById(`contactphone-${id}`);
  if (contactPhoneEl) payload.contact_phone = contactPhoneEl.value || null;
  // Enforced on the client only, same reasoning as the placeholder itself —
  // added 2026-08-26 after some Deletion/Correction entries were found saved
  // with no type at all (the blank "-" option could be left selected).
  if (payload.sub_category === "Deletion" && !payload.deletion_type) {
    const msg = document.getElementById(`saved-${id}`);
    msg.className = "save-msg error";
    msg.textContent = t("chooseDeletionType");
    return;
  }
  if (payload.sub_category === "Correction needed" && !payload.correction_type) {
    const msg = document.getElementById(`saved-${id}`);
    msg.className = "save-msg error";
    msg.textContent = t("chooseCorrectionType");
    return;
  }
  // Enforced on the client only. The server stays lenient because a queued
  // offline write that the server rejects is a lost entry, and this form
  // already blocks the mistake at the point it would be made.
  if (payload.correction_type === WRONGFUL_DELETION && !(payload.contact_phone || "").trim()) {
    const msg = document.getElementById(`saved-${id}`);
    msg.className = "save-msg error";
    msg.textContent = t("phoneRequiredHint");
    return;
  }
  if (pendingPhotos[id]) payload.death_cert_photo = pendingPhotos[id];
  else if (removedPhotos.has(id)) payload.remove_death_cert = true;

  if (btn) btn.disabled = true;
  try {
    const { record } = await api.queueOp({ type: "status", elector_id: id, payload });
    if (record) currentResults = currentResults.map((e) => (e.id === id ? record : e));
    delete pendingPhotos[id];
    removedPhotos.delete(id);
    // Render first — renderResults() rebuilds the card, including a fresh,
    // re-enabled Save button, which is also this function's re-enable path.
    renderResults();
    document.getElementById(`expand-${id}`).classList.add("open");
    showToast(api.state.online ? t("saved") : t("savedOffline"), { variant: "success" });
  } catch (err) {
    renderResults();
    document.getElementById(`expand-${id}`).classList.add("open");
    const savedMsg = document.getElementById(`saved-${id}`);
    if (savedMsg) {
      savedMsg.className = "save-msg error";
      savedMsg.textContent = err.message || t("errorSaving");
    }
  }
}

// Resizes to at most 1600px on the long edge and re-encodes as JPEG at 82%
// quality, then travels inside the queued offline write — the client always
// compresses before sending, so a 4 MB phone photo never crosses the network.
//
// These two numbers are a legibility setting, not a cost setting. What is
// being photographed is a death certificate, and the evidentiary payload is
// the printed registration number — small text, often shot at an angle in
// poor light, which is exactly what JPEG artefacts destroy first. The earlier
// 1200px/0.70 produced ~90 KB and risked an unreadable number; 1600px/0.82
// produces ~250-350 KB and holds the small print.
//
// Storage is not the constraint and should not drive these down again: R2
// bills nothing below 10 GB per month, and 500 certificates at this setting
// is under 200 MB — under 2% of that allowance. Raise them if certificates
// come back unreadable from the field.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const maxEdge = 1600;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        // Smooth downscaling; the default is nearest-neighbour in some
        // browsers, which shreds small printed text.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// A wrongful deletion is a claim that the roll removed someone who should
// still be on it, and acting on it means contacting them to get them
// restored. Without a number the finding cannot be followed up, so the phone
// is required here and merely offered for the other correction types.
const WRONGFUL_DELETION = "Wrongful Deletion";

function renderCorrectionExtras(id) {
  const wrap = document.getElementById(`correction-phone-${id}`);
  if (!wrap) return;
  const sel = document.getElementById(`correctiontype-${id}`);
  const type = sel ? sel.value : "";
  const e = currentResults.find((x) => x.id === id) || {};
  // Carry across anything already typed — this re-renders on every change of
  // the sub-category, and losing a half-entered number would be maddening.
  const typed = document.getElementById(`contactphone-${id}`);
  const value = typed ? typed.value : e.contact_phone || "";
  const required = type === WRONGFUL_DELETION;

  wrap.innerHTML = `
    <span class="field-label">${t("contactPhone")}${required ? " *" : ""}</span>
    <input id="contactphone-${id}" type="tel" value="${value}" />
    ${required ? `<div class="field-hint">${t("phoneRequiredHint")}</div>` : ""}
  `;
}

// A death certificate only belongs to a deletion whose type is Death. For the
// other two types the field is not shown at all, rather than shown and
// ignored — an upload box on a "permanently shifted" record invites a
// surveyor to photograph something that should not be stored.
function renderDeletionExtras(id) {
  const wrap = document.getElementById(`deletion-extra-${id}`);
  if (!wrap) return;
  const select = document.getElementById(`deletiontype-${id}`);
  const type = select ? select.value : "";
  const e = currentResults.find((x) => x.id === id) || {};

  if (type !== "Death") {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = `
    <div class="row">
      <div>
        <span class="field-label">${t("deathCertPhoto")}</span>
        ${e.death_cert_file ? `<img class="photo-thumb" src="/api/uploads/${e.death_cert_file}" alt="">` : ""}
        <input type="file" accept="image/*" capture="environment" id="photo-${id}" onchange="app.onPhotoSelected(${id})" />
        <div class="save-msg" id="photo-msg-${id}">${pendingPhotos[id] ? t("photoUploaded") : ""}</div>
        ${e.death_cert_file ? `<span class="toggle-link" onclick="app.removePhoto(${id})">${t("removePhoto")}</span>` : ""}
      </div>
    </div>
  `;
}

async function onPhotoSelected(id) {
  const input = document.getElementById(`photo-${id}`);
  const file = input.files && input.files[0];
  const msg = document.getElementById(`photo-msg-${id}`);
  if (!file) return;
  try {
    pendingPhotos[id] = await compressImage(file);
    removedPhotos.delete(id);
    msg.textContent = t("photoUploaded");
  } catch (err) {
    msg.textContent = t("errorSaving");
  }
}

function removePhoto(id) {
  removedPhotos.add(id);
  delete pendingPhotos[id];
  const e = currentResults.find((x) => x.id === id);
  if (e) e.death_cert_file = null;
  renderFoundExtras(id);
}

// Unlocks the record so statusFormHtml() shows the full form on the next
// render, in place of this same Reopen button. Updates currentResults
// directly rather than re-running the last search/drill-down — that would
// leave a card silently stuck on the Reopen button for anyone who opened it
// from a dashboard or Monthly Pooling list (there is no search text there
// to redo a search with).
async function reopen(id) {
  try {
    const res = await fetch(`/api/elector/${id}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: false }),
    });
    if (!res.ok) throw new Error();
    const record = await res.json();
    currentResults = currentResults.map((e) => (e.id === id ? record : e));
    renderResults();
    document.getElementById(`expand-${id}`).classList.add("open");
  } catch (err) {
    showToast(t("errorSaving"), { variant: "error" });
  }
}

/* ----------------------------------------------------------- add form */

function showAddForm() {
  const wrap = document.getElementById("addFormWrap");
  wrap.innerHTML = `
    <div class="card">
      <div class="section-title">${t("addNewIndividual")}</div>
      <div class="row">
        <div>
          <span class="field-label">${t("houseNumber")}</span>
          <input id="new-house" placeholder="${t("houseNumberPlaceholder")}" onblur="app.autofillHouse()" />
        </div>
        <div>
          <span class="field-label">${t("partNumber")}</span>
          <input id="new-part" placeholder="${t("partNumberPlaceholder")}" />
        </div>
      </div>
      <div class="row">
        <div>
          <span class="field-label">${t("name")}</span>
          <input id="new-name" />
        </div>
        <div>
          <span class="field-label">${t("age")}</span>
          <input id="new-age" />
        </div>
      </div>
      <div class="row">
        <div>
          <span class="field-label">${t("gender")}</span>
          <select id="new-gender">
            ${GENDER_OPTS.map((v) => `<option value="${v}">${t(GENDER_KEY[v])}</option>`).join("")}
          </select>
        </div>
        <div>
          <span class="field-label">${t("additionCategory")}</span>
          <select id="new-category" onchange="app.renderAdditionPhoneExtra()">
            <option value="" disabled selected>${t("optDash")}</option>
            ${appConfig.addition_categories.map((v) => `<option value="${v}">${valueLabel(v)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="row">
        <div id="new-phone-wrap">
          <span class="field-label">${t("contactPhone")}</span>
          <input id="new-phone" type="tel" />
        </div>
        <div>
          <span class="field-label">${t("form6Given")}</span>
          <select id="new-form6">
            <option value="">${t("optDash")}</option>
            ${appConfig.yes_no.map((v) => `<option value="${v}">${v === "Yes" ? t("optYes") : t("optNo")}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <span class="field-label">${t("notes")}</span>
          <textarea id="new-notes" rows="2" style="width:100%"></textarea>
        </div>
      </div>
      <button id="new-save-btn" onclick="app.submitNew()">${t("saveIndividual")}</button>
      <button class="secondary" onclick="document.getElementById('addFormWrap').innerHTML=''">${t("cancel")}</button>
      <div class="save-msg" id="new-saved"></div>
    </div>
  `;
}

// A wrongful deletion found in the field is a claim that the source roll
// already dropped someone who should still be on it — following up means
// contacting them, so the phone is required here, mirroring
// renderCorrectionExtras()'s reasoning for the same category on an existing
// record.
function renderAdditionPhoneExtra() {
  const wrap = document.getElementById("new-phone-wrap");
  if (!wrap) return;
  const catEl = document.getElementById("new-category");
  const category = catEl ? catEl.value : "";
  const typed = document.getElementById("new-phone");
  const value = typed ? typed.value : "";
  const required = category === WRONGFUL_DELETION;
  wrap.innerHTML = `
    <span class="field-label">${t("contactPhone")}${required ? " *" : ""}</span>
    <input id="new-phone" type="tel" value="${value}" />
    ${required ? `<div class="field-hint">${t("phoneRequiredHint")}</div>` : ""}
  `;
}

async function autofillHouse() {
  const house = document.getElementById("new-house").value.trim();
  if (!house) return;
  const baseGuess = (house.match(/^[A-Za-z]?[\d/]+[A-Za-z]?/) || [house])[0];
  try {
    const d = await api.houseLookup(baseGuess);
    document.getElementById("new-part").value = d.part_number;
  } catch (e) {}
}

// This is the fix for the duplicate-addition reports: the old version left
// the button enabled and the form populated after a successful save, and the
// only feedback was a small "Saved." next to the button — easy to miss, so a
// surveyor unsure whether the tap registered would press it again, and each
// press queued a genuinely new addition (distinct op_id, so the server's
// own idempotency check never saw them as the same request). Disabling the
// button the instant it is pressed blocks a literal double-tap; clearing the
// form to nothing on success means a second, slower tap has nothing left in
// it to resubmit; and the toast is much harder to miss than inline text.
async function submitNew() {
  const btn = document.getElementById("new-save-btn");
  if (btn.disabled) return;
  const payload = {
    part_number: document.getElementById("new-part").value,
    house_number_raw: document.getElementById("new-house").value,
    name: document.getElementById("new-name").value,
    age: document.getElementById("new-age").value,
    gender: document.getElementById("new-gender").value,
    addition_category: document.getElementById("new-category").value || null,
    contact_phone: document.getElementById("new-phone").value || null,
    form6_given: document.getElementById("new-form6").value || null,
    notes: document.getElementById("new-notes").value || null,
  };
  // Enforced on the client only, same reasoning as renderCorrectionExtras():
  // a queued offline write the server rejects would be a lost entry. Added
  // 2026-08-26 alongside the same requirement for deletion/correction type,
  // after some entries were found saved with the category left blank.
  if (!payload.addition_category) {
    const msg = document.getElementById("new-saved");
    if (msg) {
      msg.className = "save-msg error";
      msg.textContent = t("chooseAdditionCategory");
    }
    return;
  }
  if (payload.addition_category === WRONGFUL_DELETION && !(payload.contact_phone || "").trim()) {
    const msg = document.getElementById("new-saved");
    if (msg) {
      msg.className = "save-msg error";
      msg.textContent = t("phoneRequiredHint");
    }
    return;
  }
  btn.disabled = true;
  try {
    await api.queueOp({ type: "addition", payload });
    showToast(api.state.online ? t("added") : t("savedOffline"), { variant: "success" });
    // Clear and collapse the form entirely — a second tap, however late,
    // now has nothing populated to resubmit. Reopen via the Addition button
    // to record another person.
    document.getElementById("addFormWrap").innerHTML = "";
  } catch (err) {
    const savedMsg = document.getElementById("new-saved");
    if (savedMsg) savedMsg.textContent = err.message || t("errorSaving");
    btn.disabled = false;
  }
}

/* ----------------------------------------------------------- dashboard */

// Indian digit grouping (9,601 — not 9601), matching how the roll itself is
// quoted. Applied to dashboard figures only; record fields like EPIC and part
// number are identifiers, not quantities, and must never be grouped.
function fmtNum(n) {
  return typeof n === "number" ? n.toLocaleString("en-IN") : n;
}

function statCard(kind, value, label, def, opts = {}) {
  const clickable = kind ? " clickable" : "";
  const onclick = kind ? ` onclick="app.drillDown('${kind}')"` : "";
  return `
    <div class="dash-stat${opts.headline ? " headline" : ""}${clickable}"${onclick}>
      <b>${value}</b><span class="dash-label">${label}</span>
      ${opts.formula ? `<div class="dash-formula">${opts.formula}</div>` : ""}
      ${def ? `<div class="dash-def">${def}</div>` : ""}
      ${kind ? `<div class="drill-hint">${t("viewList")}</div>` : ""}
    </div>`;
}

async function loadDashboard() {
  const el = document.getElementById("dashboardView");
  if (!api.state.online) {
    el.innerHTML = `<div class="empty">${t("statusOffline")}</div>`;
    return;
  }
  const [d, parts, mine, activeDays] = await Promise.all([
    api.dashboard(),
    api.parts(),
    api.mySummary(),
    api.reportDays(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const dayOptions = activeDays.length ? activeDays : [today];
  el.innerHTML = `
    <div class="dash-grid">
      ${statCard("revised_roll", fmtNum(d.revised_total), t("dashRevisedTotal"), dashDef("revised_total"), {
        headline: true,
        formula: t("dashRevisedFormula"),
      })}
      ${statCard("base_roll", fmtNum(d.base_roll_total), t("dashBaseTotal"), dashDef("base_roll_total"))}
      ${statCard("completed", fmtNum(d.verification_completed), t("dashCompleted"), dashDef("verification_completed"))}
      ${statCard("pending", fmtNum(d.pending), t("dashPending"), dashDef("pending"))}
      ${statCard("additions", fmtNum(d.additions), t("dashAdditions"), dashDef("additions"))}
      ${statCard("deletions", fmtNum(d.deletions), t("dashDeletions"), dashDef("deletions"))}
      ${statCard("corrections", fmtNum(d.corrections), t("dashCorrections"), dashDef("corrections"))}
      ${statCard("not_found_shifted", fmtNum(d.not_found_shifted), t("dashNotFoundShifted"), dashDef("not_found_shifted"))}
      ${statCard(null, d.percent_complete + "%", t("dashPercent"), null)}
    </div>

    <div class="section-title">${t("dashProgressTitle")}</div>
    <div class="progress-bar"><span style="width:${Math.min(100, d.percent_complete)}%"></span></div>
    <div class="row">
      <div><span class="drill-num" onclick="app.drillDown('found')">${fmtNum(d.found)}</span> ${t("dashFound")}</div>
      <div><span class="drill-num" onclick="app.drillDown('not_found')">${fmtNum(d.not_found)}</span> ${t("dashNotFound")}</div>
      <div><span class="drill-num" onclick="app.drillDown('pending')">${fmtNum(d.pending)}</span> ${t("dashPending")}</div>
    </div>

    <div class="section-title">${t("partsTitle")}</div>
    <table class="parts">
      <thead><tr>
        <th>${t("partCol")}</th><th>${t("partColBase")}</th><th>${t("partColDone")}</th>
        <th>${t("partColAdditions")}</th><th>${t("partColDeletions")}</th><th>${t("partColCorrections")}</th>
      </tr></thead>
      <tbody>
        ${parts
          .map(
            (p) => `<tr>
              <td>${p.part_number}</td>
              <td><span class="drill-num" onclick="app.drillDown('base_roll','${p.part_number}')">${fmtNum(p.base_total)}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('completed','${p.part_number}')">${fmtNum(p.done)}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('additions','${p.part_number}')">${fmtNum(p.additions)}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('deletions','${p.part_number}')">${fmtNum(p.deletions)}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('corrections','${p.part_number}')">${fmtNum(p.corrections)}</span></td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <div class="meta">${t("partsFootnote")}</div>

    <div class="section-title">${t("mySummaryTitle")}</div>
    <div class="dash-grid">
      <div class="dash-stat"><b>${mine.verifications}</b><span class="dash-label">${t("mySummaryVerifications")}</span></div>
      <div class="dash-stat"><b>${mine.additions}</b><span class="dash-label">${t("mySummaryAdditions")}</span></div>
      <div class="dash-stat"><b>${mine.deletions}</b><span class="dash-label">${t("mySummaryDeletions")}</span></div>
      <div class="dash-stat"><b>${mine.corrections}</b><span class="dash-label">${t("mySummaryCorrections")}</span></div>
    </div>

    <div class="section-title">${t("dailyActivityTitle")}</div>
    <div class="row" style="max-width:220px">
      <div>
        <span class="field-label">${t("dailyActivityDate")}</span>
        <select id="daily-date" onchange="app.loadDailyActivity()">
          ${dayOptions.map((d) => `<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="dailyActivityWrap"></div>

    <div class="section-title">${t("exportsTitle")}</div>
    ${["full", "additions", "deletions", "corrections", "not_found"]
      .map(
        (kind) => `
      <div class="export-row">
        <span class="field-label export-label">${t("export" + kind.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase()))}</span>
        <button class="secondary" onclick="window.location.href='/api/export/${kind}?format=csv'">${t("csv")}</button>
        <button class="secondary" onclick="window.location.href='/api/export/${kind}?format=zip'">${t("zip")}</button>
        <button class="secondary" onclick="window.location.href='/api/export/${kind}?format=xlsx'">${t("xlsx")}</button>
      </div>`
      )
      .join("")}
    <div class="export-row">
      <span class="field-label export-label">${t("downloadDatabase")}</span>
      <button class="secondary" onclick="window.location.href='/api/export-database'">${t("zip")}</button>
    </div>
  `;
  loadDailyActivity();
}

async function loadDailyActivity() {
  const wrap = document.getElementById("dailyActivityWrap");
  const dateInput = document.getElementById("daily-date");
  const date = dateInput ? dateInput.value : undefined;
  const daily = await api.dailyReport(date);
  if (!daily.rows.length) {
    wrap.innerHTML = `<div class="empty">${t("dailyActivityEmpty")}</div>`;
    return;
  }
  // Every count below is clickable through to the exact list behind it, for
  // one person, on this one day — "who verified/added/deleted whom" for
  // quality control, per the owner's request (2026-08-18). Reuses the
  // dashboard's own kind filters via the same /api/records?user=&date=
  // extension the dashboard tiles use, so a number here and the dashboard's
  // equivalent total can never disagree about what counts as what.
  wrap.innerHTML = `
    <table class="parts">
      <thead><tr>
        <th>${t("dailyActivityStaff")}</th><th>${t("dailyActivityVerifications")}</th>
        <th>${t("dailyActivityAdditions")}</th><th>${t("dailyActivityDeletions")}</th><th>${t("dailyActivityCorrections")}</th>
      </tr></thead>
      <tbody>
        ${daily.rows
          .map(
            (r) => `<tr>
              <td>${staffLabel(r.email)}</td>
              <td><span class="drill-num" onclick="app.drillDown('completed', null, '${r.email}', '${daily.date}')">${r.verifications}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('additions', null, '${r.email}', '${daily.date}')">${r.additions}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('deletions', null, '${r.email}', '${daily.date}')">${r.deletions}</span></td>
              <td><span class="drill-num" onclick="app.drillDown('corrections', null, '${r.email}', '${daily.date}')">${r.corrections}</span></td>
            </tr>`
          )
          .join("")}
        <tr style="font-weight:600">
          <td>${t("dailyActivityTotal")}</td><td>${daily.totals.verifications}</td>
          <td>${daily.totals.additions}</td><td>${daily.totals.deletions}</td><td>${daily.totals.corrections}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/* ---------------------------------------------------------------- team */

// Verification/addition counts used to appear here per person. Dropped
// 2026-08-18 at the owner's request: they duplicated the Dashboard's Daily
// Activity table, which now drills down per person per day (see
// DRILL_TITLE_KEY / loadDailyActivity above) — a better fit for "who did
// what" than a running lifetime total on the roster screen. This screen's
// job is now just who is on the team, and when they were last active.
async function loadTeam() {
  const el = document.getElementById("teamView");
  if (!isAdmin) {
    el.innerHTML = `<div class="empty">${t("statusOffline")}</div>`;
    return;
  }
  if (!api.state.online) {
    el.innerHTML = `<div class="empty">${t("statusOffline")}</div>`;
    return;
  }
  await loadDirectory(); // refresh so a name someone just set shows immediately
  const staff = await api.listStaff();
  const roleLabel = { super_admin: t("roleSuperAdmin"), coordinator: t("roleCoordinator"), staff: "" };
  el.innerHTML = `
    <div class="section-title">${t("teamTitle")}</div>
    ${
      isSuperAdmin
        ? `<div class="card" style="margin-bottom:16px">
        <div class="row">
          <div>
            <span class="field-label">${t("teamAddCoordinator")}</span>
            <input id="team-add-email" placeholder="name@example.com" />
          </div>
        </div>
        <button onclick="app.addTeamCoordinator()">${t("teamAddBtn")}</button>
        <span class="save-msg" id="team-add-msg"></span>
      </div>`
        : ""
    }
    <table class="parts">
      <thead><tr>
        <th>${t("teamName")}</th><th>${t("teamEmail")}</th><th>${t("teamCoordinator")}</th>
        <th>${t("teamLastActive")}</th>${isSuperAdmin ? "<th></th>" : ""}
      </tr></thead>
      <tbody>
        ${staff
          .map(
            (s) => `<tr>
              <td>${s.name ? escapeHtml(s.name) : "-"}</td>
              <td>${s.email}</td>
              <td>${roleLabel[s.role]}</td>
              <td>${s.last_active ? fmtDateTime(s.last_active) : "-"}</td>
              ${
                isSuperAdmin
                  ? `<td>
                ${
                  s.role === "super_admin"
                    ? ""
                    : `<span class="toggle-link" onclick="app.toggleTeamAdmin('${s.email}', ${s.role !== "coordinator"})">
                  ${s.role === "coordinator" ? t("teamRemoveAdmin") : t("teamMakeAdmin")}
                </span>`
                }
              </td>`
                  : ""
              }
            </tr>`
          )
          .join("")}
      </tbody>
    </table>

    ${isSuperAdmin ? `<div id="dangerZone"></div>` : ""}
  `;
  if (isSuperAdmin) loadDangerZone();
}

/* Bulk reset.
 *
 * Presented as a plainly-labelled destructive action rather than a tidy
 * "clear test data" button, because the database has no is_test flag and
 * cannot tell a test entry from a surveyor's real work. Before fieldwork
 * starts the two are the same thing; afterwards they are emphatically not,
 * and the wording has to survive that transition without misleading anyone.
 *
 * The counts are fetched fresh each time so the confirmation states what is
 * actually about to be destroyed, not what was there when the tab loaded.
 */
async function loadDangerZone() {
  const el = document.getElementById("dangerZone");
  if (!el) return;
  let p;
  try {
    p = await api.resetPreview();
  } catch (err) {
    el.innerHTML = "";
    return;
  }
  const total = p.verifications + p.field_additions + p.revisit_flags;

  el.innerHTML = `
    <div class="section-title danger-title">${t("resetAllTitle")}</div>
    <div class="card danger-card">
      <p class="danger-lead">${t("resetAllWarning")}</p>
      <table class="parts">
        <tbody>
          <tr><td>${t("resetAllVerifications")}</td><td><b>${fmtNum(p.verifications)}</b></td></tr>
          <tr><td>${t("resetAllAdditions")}</td><td><b>${fmtNum(p.field_additions)}</b></td></tr>
          <tr><td>${t("resetAllRevisits")}</td><td><b>${fmtNum(p.revisit_flags)}</b></td></tr>
          <tr><td>${t("resetAllHistory")}</td><td><b>${fmtNum(p.history_entries)}</b></td></tr>
          <tr><td>${t("resetAllPhotos")}</td><td><b>${fmtNum(p.photos)}</b></td></tr>
        </tbody>
      </table>
      <p class="danger-lead">${t("resetAllKeeps")(fmtNum(p.base_roll_total))}</p>
      ${
        total === 0
          ? `<div class="empty">${t("resetAllNothing")}</div>`
          : `<span class="field-label">${t("resetAllTypeToConfirm")(p.confirmation_phrase)}</span>
             <input id="reset-confirm" autocomplete="off" placeholder="${p.confirmation_phrase}" />
             <div style="margin-top:12px">
               <button class="danger" onclick="app.confirmResetAll()">${t("resetAllButton")}</button>
               <span class="save-msg" id="reset-msg"></span>
             </div>`
      }
    </div>
  `;
}

async function confirmResetAll() {
  const input = document.getElementById("reset-confirm");
  const msg = document.getElementById("reset-msg");
  const phrase = (input.value || "").trim();
  msg.className = "save-msg error";

  try {
    const out = await api.resetAll(phrase);
    msg.className = "save-msg";
    msg.textContent = t("resetAllDone")(
      fmtNum(out.cleared.verifications + out.cleared.field_additions + out.cleared.revisit_flags)
    );
    // The device still holds the pre-reset roll in IndexedDB. Pull a fresh
    // snapshot so an offline search does not keep returning records that no
    // longer carry the verifications it shows.
    currentResults = [];
    renderResults();
    await api.refreshRoll().catch(() => {});
    loadDangerZone();
  } catch (err) {
    msg.textContent = err.detail || err.message || t("errorSaving");
  }
}

async function toggleTeamAdmin(email, makeAdmin) {
  await api.setAdmin(email, makeAdmin);
  loadTeam();
}

// Promotes someone straight to Team Coordinator by email, even if they've
// never submitted anything yet — the table above only lists people who
// already have some activity trail, so this is the only way to add someone
// brand new.
async function addTeamCoordinator() {
  const input = document.getElementById("team-add-email");
  const msg = document.getElementById("team-add-msg");
  const email = input.value.trim().toLowerCase();
  if (!email) return;
  try {
    await api.setAdmin(email, true);
    input.value = "";
    msg.textContent = "";
    loadTeam();
  } catch (err) {
    msg.textContent = err.message || t("errorSaving");
  }
}

/* ------------------------------------------------------------ drill-down */

// Drill-down list names, mapped to the dashboard labels already translated
// above so a list and the tile it came from read identically.
const DRILL_TITLE_KEY = {
  full: "exportFull",
  base_roll: "dashBaseTotal",
  completed: "dashCompleted",
  pending: "dashPending",
  found: "dashFound",
  not_found: "dashNotFound",
  not_found_shifted: "dashNotFoundShifted",
  additions: "dashAdditions",
  deletions: "dashDeletions",
  corrections: "dashCorrections",
  duplicates: "badgeDupEpic",
  deleted_in_source: "badgeDeletedSource",
  modified_in_source: "badgeModifiedSource",
  source_roll_update_additions: "tabSourceUpdate",
  unidentified_deletions: "tabUnidentifiedDeletions",
  revised_roll: "dashRevisedTotal",
};

// Which field breaks a list down into its sub-types, for the three
// categories the owner asked to see a breakdown for on drill-down — how many
// of these additions/deletions/corrections are each sub-type, not just the
// total. Every other drill-down kind (found, pending, source-roll lists,
// etc.) has no natural sub-type field and gets no summary line.
const SUMMARY_FIELD = {
  additions: "addition_category",
  deletions: "deletion_type",
  corrections: "correction_type",
};

// The full, unfiltered drill-down list — kept separate from currentResults
// so clicking a sub-type in the breakdown (filterDrillSubType) can narrow
// what's displayed without losing the rest or re-fetching from the server.
// drillKind/drillContextArgs let renderDrillContext() rebuild the header
// after a sub-type click without re-running drillDown() itself.
let drillFullResults = [];
let drillKind = null;
let drillContextArgs = { part: null, user: null, date: null, total: 0, distinctEpics: 0, title: "" };
let drillSubTypeFilter = null; // { field, value } or null

// Each entry is its own clickable filter (click again to clear it) — counts
// always come from drillFullResults, not the currently-filtered
// currentResults, so every option in the breakdown stays visible and
// clickable no matter which one is currently active.
function summaryBreakdownHtml(kind) {
  const field = SUMMARY_FIELD[kind];
  if (!field || !drillFullResults.length) return "";
  const counts = new Map();
  for (const r of drillFullResults) {
    const key = r[field] || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const label = key ? valueLabel(key) : t("notSpecified");
      const active = drillSubTypeFilter && drillSubTypeFilter.field === field && drillSubTypeFilter.value === key;
      const text = `${label}: ${fmtNum(n)}`;
      const safeKey = key.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `<span class="toggle-link" onclick="app.filterDrillSubType('${field}', '${safeKey}')">${active ? `<b>${text}</b>` : text}</span>`;
    });
  return `<div class="meta">${t("drillSummary")}: ${parts.join(" &middot; ")}</div>`;
}

function renderDrillContext() {
  const { part, user, date, total, title, distinctEpics } = drillContextArgs;
  const ctx = document.getElementById("drillContext");
  ctx.style.display = "block";
  const extra = [
    part ? `${t("metaPart")} ${part}` : "",
    user ? staffLabel(user) : "",
    date ? date : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");
  // The sub-type filter narrows what's shown from the same already-fetched
  // list, so its count is exact; the unfiltered count is the server's own
  // COUNT(*) (data.total), not just how many rows this page happened to
  // fetch — the two can differ if a list ever outgrows the 500-row fetch
  // cap in api.records(), which is called out explicitly rather than left
  // to look like a silently short list.
  const shownCount = drillSubTypeFilter ? currentResults.length : total;
  const truncated = !drillSubTypeFilter && drillFullResults.length < total;
  // Base-roll lists count a two-part enrolment (or a Supplement 5 part-move)
  // as two rows; the dashboard tile counts the voter once. Show both so the
  // list length and the tile it was opened from visibly reconcile. Only for
  // the pure base-roll lists — elsewhere (revised_roll mixes in field
  // additions that have no EPIC) a distinct-EPIC count would mislead.
  const EPIC_COUNTED = ["base_roll", "completed", "pending", "found", "not_found", "not_found_shifted"];
  const epicNote =
    !drillSubTypeFilter && EPIC_COUNTED.includes(drillKind) && distinctEpics && distinctEpics !== total
      ? ` &middot; ${fmtNum(distinctEpics)} ${t("drillUniqueVoters")}`
      : "";
  ctx.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--sp-2)">
      <span>${t("drillShowing")}: <b>${title}</b>${extra ? ` &middot; ${extra}` : ""} (${truncated ? `${fmtNum(shownCount)}/${fmtNum(total)}` : fmtNum(shownCount)})${epicNote}</span>
      <span class="toggle-link" onclick="app.clearDrilldown()">${t("drillClear")}</span>
    </div>
    ${
      // Skipped for a per-user/per-day narrowing — a single person's day is
      // already narrow enough that a sub-type breakdown adds noise rather
      // than insight.
      user || date ? "" : summaryBreakdownHtml(drillKind)
    }
  `;
}

function filterDrillSubType(field, value) {
  const clearing = drillSubTypeFilter && drillSubTypeFilter.field === field && drillSubTypeFilter.value === value;
  drillSubTypeFilter = clearing ? null : { field, value };
  currentResults = drillSubTypeFilter
    ? drillFullResults.filter((r) => (r[field] || "") === drillSubTypeFilter.value)
    : drillFullResults;
  renderDrillContext();
  renderResults();
}

async function drillDown(kind, part, user, date) {
  const data = await api.records(kind, part, user, date);
  drillFullResults = data.records || [];
  drillKind = kind;
  drillSubTypeFilter = null;
  currentResults = drillFullResults;
  lastSearch = {}; // this list didn't come from a search — no match-type note to show
  showTab("search");

  // The API sends an English title (FILTER_TITLES in src/filters.ts). Prefer
  // the translated label for the same list and fall back to the server's
  // wording only for a kind this dictionary does not know about.
  const title = DRILL_TITLE_KEY[kind] ? t(DRILL_TITLE_KEY[kind]) : data.title;
  drillContextArgs = { part, user, date, total: data.total, distinctEpics: data.distinct_epics, title };
  renderDrillContext();
  renderResults();
}

function clearDrilldown() {
  document.getElementById("drillContext").style.display = "none";
  currentResults = [];
  drillFullResults = [];
  drillKind = null;
  drillSubTypeFilter = null;
  renderResults();
}

/* ----------------------------------------------------------- status pill */

function updateStatusPill() {
  // In public mode the pill shows the live-feed state and is owned by
  // public-dashboard.js — an online/offline event here must not clobber it.
  if (publicMode) return;
  const pill = document.getElementById("statusPill");
  if (!api.state.online) {
    pill.textContent = t("statusOffline");
    pill.className = "status-pill offline";
  } else if (api.state.syncing) {
    pill.textContent = t("statusSyncing");
    pill.className = "status-pill syncing";
  } else if (api.state.pending > 0) {
    pill.textContent = t("statusPending")(api.state.pending);
    pill.className = "status-pill syncing";
  } else {
    pill.textContent = "";
    pill.className = "status-pill";
  }
}

api.onStateChange(updateStatusPill);

/* --------------------------------------------------------------- init */

window.app = {
  setLang,
  showArea,
  showTab,
  showMonthlyPoolingAdditions,
  showMonthlyPoolingUnidentifiedDeletions,
  doSearch,
  showAddForm,
  renderAdditionPhoneExtra,
  toggleExpand,
  renderSubCategory,
  renderFoundExtras,
  saveStatus,
  reopen,
  autofillHouse,
  submitNew,
  loadDailyActivity,
  drillDown,
  clearDrilldown,
  filterDrillSubType,
  refreshCurrentView,
  toggleTeamAdmin,
  addTeamCoordinator,
  renderCorrectionExtras,
  renderDeletionExtras,
  onPhotoSelected,
  removePhoto,
  loadDangerZone,
  confirmResetAll,
  showEditDetails,
  submitEditDetails,
  deleteEntryAction,
  jumpToWorklistVoter,
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

api.onLiveUpdate(() => {
  // A person mid-edit shouldn't have their form yanked out from under them —
  // surface a banner instead of silently refreshing.
  document.getElementById("liveBanner").classList.add("show");
});

/* ----------------------------------------------------------------- boot */

/* Is this visitor signed in through Cloudflare Access?
 *
 * /api/* stays behind Access; the rest of the site is public. For a visitor
 * without a session, Access answers /api/whoami with a redirect to the OTP
 * page on another origin. redirect:"manual" surfaces that as an opaque
 * response we can test for, instead of a CORS failure in the console.
 *
 * Locally there is no Access at all, so this returns 200 with email:null —
 * which is why the check below is "did the request get through", not "is
 * there an email". That keeps `wrangler dev` showing the staff app as it
 * always has; add ?public=1 to preview the signed-out view locally.
 *
 * Offline is the normal case in the field, not an edge case, so this must
 * never fail closed to the public view: a surveyor opening the installed PWA
 * with no signal has to land in the staff app with its cached roll and
 * outbox. When Access can't be reached we trust the last known answer for
 * this device instead — a phone that has signed in before stays in the staff
 * app, and one that never has still gets the public view.
 */
const SIGNED_IN_KEY = "wasSignedIn";

async function isSignedIn() {
  if (!navigator.onLine) return localStorage.getItem(SIGNED_IN_KEY) === "1";
  try {
    const res = await fetch("/api/whoami", { redirect: "manual", cache: "no-store" });
    const ok = res.ok && res.type !== "opaqueredirect";
    localStorage.setItem(SIGNED_IN_KEY, ok ? "1" : "0");
    return ok;
  } catch (e) {
    // Nominally online but the request failed — flaky signal, captive portal,
    // dropped connection mid-boot. Same reasoning as the offline branch.
    return localStorage.getItem(SIGNED_IN_KEY) === "1";
  }
}

async function showPublicHome() {
  document.getElementById("appChrome").style.display = "none";
  document.getElementById("publicView").style.display = "";
  document.getElementById("userIdentity").style.display = "none";
  const { startPublicDashboard } = await import("./public-dashboard.js");
  publicMode = true;
  // Stop api.js reaching for /api/* on network events — it is all gated.
  api.setStaffMode(false);
  startPublicDashboard(document.getElementById("publicView"), lang);
}

function showStaffApp() {
  document.getElementById("publicView").style.display = "none";
  document.getElementById("appChrome").style.display = "";
  // Hyderabad has one area, and its picker is hidden in index.html, so open it
  // directly. Delhi used showArea(null) here to show the two area buttons first.
  showArea("okhla");
  loadConfig();
  return loadDirectory()
    .then(loadWhoami)
    .then(() => {
      updateStatusPill();
      api.refreshRoll().catch(() => {});
      api.syncNow();
      api.connectLive();
      // Fire-and-forget: the app is already usable while this resolves, and
      // it must never block search/verify on a slow name-prompt round trip.
      requestNameIfMissing();
    });
}

applyStaticText();

// ?public=1 forces the signed-out view. It exists so the public page can be
// previewed against `wrangler dev` (where no Access layer exists) and checked
// in production without signing out. Harmless either way — it only ever shows
// less than the visitor is already entitled to see.
const forcePublic = new URLSearchParams(location.search).has("public");

(forcePublic ? Promise.resolve(false) : isSignedIn()).then((signedIn) =>
  signedIn ? showStaffApp() : showPublicHome()
);
