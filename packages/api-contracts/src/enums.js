"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Currency = exports.DocumentStatus = exports.DocumentSubtype = exports.DocumentType = exports.KycStatus = exports.SignupStage = exports.VerificationChannel = exports.MfaChannel = exports.SessionRevokedReason = exports.UserStatus = exports.UserRole = exports.TransactionKind = exports.TransactionCategory = exports.TransactionStatus = exports.AccountStatus = exports.AccountType = void 0;
var AccountType;
(function (AccountType) {
    AccountType["Checking"] = "checking";
    AccountType["Savings"] = "savings";
})(AccountType || (exports.AccountType = AccountType = {}));
var AccountStatus;
(function (AccountStatus) {
    AccountStatus["Active"] = "active";
    AccountStatus["Frozen"] = "frozen";
    AccountStatus["Closed"] = "closed";
})(AccountStatus || (exports.AccountStatus = AccountStatus = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["Pending"] = "pending";
    TransactionStatus["Posted"] = "posted";
    TransactionStatus["Declined"] = "declined";
    TransactionStatus["Reversed"] = "reversed";
})(TransactionStatus || (exports.TransactionStatus = TransactionStatus = {}));
var TransactionCategory;
(function (TransactionCategory) {
    TransactionCategory["Groceries"] = "groceries";
    TransactionCategory["Dining"] = "dining";
    TransactionCategory["Transport"] = "transport";
    TransactionCategory["Entertainment"] = "entertainment";
    TransactionCategory["Shopping"] = "shopping";
    TransactionCategory["Bills"] = "bills";
    TransactionCategory["Health"] = "health";
    TransactionCategory["Travel"] = "travel";
    TransactionCategory["Utilities"] = "utilities";
    TransactionCategory["Transfer"] = "transfer";
    TransactionCategory["Income"] = "income";
    TransactionCategory["Other"] = "other";
})(TransactionCategory || (exports.TransactionCategory = TransactionCategory = {}));
var TransactionKind;
(function (TransactionKind) {
    TransactionKind["CardPurchase"] = "card_purchase";
    TransactionKind["AchIn"] = "ach_in";
    TransactionKind["AchOut"] = "ach_out";
    TransactionKind["P2pIn"] = "p2p_in";
    TransactionKind["P2pOut"] = "p2p_out";
    TransactionKind["Fee"] = "fee";
    TransactionKind["Interest"] = "interest";
    TransactionKind["Deposit"] = "deposit";
    TransactionKind["Refund"] = "refund";
    TransactionKind["Adjustment"] = "adjustment";
})(TransactionKind || (exports.TransactionKind = TransactionKind = {}));
var UserRole;
(function (UserRole) {
    UserRole["Customer"] = "customer";
    UserRole["Admin"] = "admin";
    UserRole["SuperAdmin"] = "superadmin";
})(UserRole || (exports.UserRole = UserRole = {}));
var UserStatus;
(function (UserStatus) {
    UserStatus["Active"] = "active";
    UserStatus["Frozen"] = "frozen";
    UserStatus["Closed"] = "closed";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
var SessionRevokedReason;
(function (SessionRevokedReason) {
    SessionRevokedReason["UserSignout"] = "user_signout";
    SessionRevokedReason["NewerLogin"] = "newer_login";
    SessionRevokedReason["PasswordChanged"] = "password_changed";
    SessionRevokedReason["AdminRevoke"] = "admin_revoke";
    SessionRevokedReason["ReuseDetected"] = "reuse_detected";
})(SessionRevokedReason || (exports.SessionRevokedReason = SessionRevokedReason = {}));
var MfaChannel;
(function (MfaChannel) {
    MfaChannel["Sms"] = "sms";
})(MfaChannel || (exports.MfaChannel = MfaChannel = {}));
var VerificationChannel;
(function (VerificationChannel) {
    VerificationChannel["Email"] = "email";
    VerificationChannel["Sms"] = "sms";
})(VerificationChannel || (exports.VerificationChannel = VerificationChannel = {}));
var SignupStage;
(function (SignupStage) {
    SignupStage["Started"] = "started";
    SignupStage["ContactCollected"] = "contact_collected";
    SignupStage["ChannelChosen"] = "channel_chosen";
    SignupStage["Verified"] = "verified";
    SignupStage["DobCollected"] = "dob_collected";
    SignupStage["CardChosen"] = "card_chosen";
    SignupStage["AddressCollected"] = "address_collected";
    SignupStage["PasswordSet"] = "password_set";
    SignupStage["DetailsCollected"] = "details_collected";
    SignupStage["SsnCollected"] = "ssn_collected";
    SignupStage["DocsSubmitted"] = "docs_submitted";
    SignupStage["Completed"] = "completed";
    SignupStage["Abandoned"] = "abandoned";
})(SignupStage || (exports.SignupStage = SignupStage = {}));
var KycStatus;
(function (KycStatus) {
    KycStatus["Pending"] = "pending";
    KycStatus["InReview"] = "in_review";
    KycStatus["Approved"] = "approved";
    KycStatus["Rejected"] = "rejected";
})(KycStatus || (exports.KycStatus = KycStatus = {}));
var DocumentType;
(function (DocumentType) {
    DocumentType["IdFront"] = "id_front";
    DocumentType["IdBack"] = "id_back";
    DocumentType["Selfie"] = "selfie";
    DocumentType["UtilityBill"] = "utility_bill";
})(DocumentType || (exports.DocumentType = DocumentType = {}));
var DocumentSubtype;
(function (DocumentSubtype) {
    DocumentSubtype["DriversLicense"] = "drivers_license";
    DocumentSubtype["Passport"] = "passport";
    DocumentSubtype["StateId"] = "state_id";
    DocumentSubtype["SsnCard"] = "ssn_card";
    DocumentSubtype["Other"] = "other";
})(DocumentSubtype || (exports.DocumentSubtype = DocumentSubtype = {}));
var DocumentStatus;
(function (DocumentStatus) {
    DocumentStatus["Pending"] = "pending";
    DocumentStatus["Approved"] = "approved";
    DocumentStatus["Rejected"] = "rejected";
})(DocumentStatus || (exports.DocumentStatus = DocumentStatus = {}));
var Currency;
(function (Currency) {
    Currency["USD"] = "USD";
    Currency["EUR"] = "EUR";
    Currency["GBP"] = "GBP";
    Currency["NGN"] = "NGN";
})(Currency || (exports.Currency = Currency = {}));
//# sourceMappingURL=enums.js.map