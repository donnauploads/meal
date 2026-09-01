export declare enum AccountType {
    Checking = "checking",
    Savings = "savings"
}
export declare enum AccountStatus {
    Active = "active",
    Frozen = "frozen",
    Closed = "closed"
}
export declare enum TransactionStatus {
    Pending = "pending",
    Posted = "posted",
    Declined = "declined",
    Reversed = "reversed"
}
export declare enum TransactionCategory {
    Groceries = "groceries",
    Dining = "dining",
    Transport = "transport",
    Entertainment = "entertainment",
    Shopping = "shopping",
    Bills = "bills",
    Health = "health",
    Travel = "travel",
    Utilities = "utilities",
    Transfer = "transfer",
    Income = "income",
    Other = "other"
}
export declare enum TransactionKind {
    CardPurchase = "card_purchase",
    AchIn = "ach_in",
    AchOut = "ach_out",
    P2pIn = "p2p_in",
    P2pOut = "p2p_out",
    Fee = "fee",
    Interest = "interest",
    Deposit = "deposit",
    Refund = "refund",
    Adjustment = "adjustment"
}
export declare enum UserRole {
    Customer = "customer",
    Admin = "admin",
    SuperAdmin = "superadmin"
}
export declare enum UserStatus {
    Active = "active",
    Frozen = "frozen",
    Closed = "closed"
}
export declare enum SessionRevokedReason {
    UserSignout = "user_signout",
    NewerLogin = "newer_login",
    PasswordChanged = "password_changed",
    AdminRevoke = "admin_revoke",
    ReuseDetected = "reuse_detected"
}
export declare enum MfaChannel {
    Sms = "sms"
}
export declare enum VerificationChannel {
    Email = "email",
    Sms = "sms"
}
export declare enum SignupStage {
    Started = "started",
    ContactCollected = "contact_collected",
    ChannelChosen = "channel_chosen",
    Verified = "verified",
    DobCollected = "dob_collected",
    CardChosen = "card_chosen",
    AddressCollected = "address_collected",
    PasswordSet = "password_set",
    DetailsCollected = "details_collected",
    SsnCollected = "ssn_collected",
    DocsSubmitted = "docs_submitted",
    Completed = "completed",
    Abandoned = "abandoned"
}
export declare enum KycStatus {
    Pending = "pending",
    InReview = "in_review",
    Approved = "approved",
    Rejected = "rejected"
}
export declare enum DocumentType {
    IdFront = "id_front",
    IdBack = "id_back",
    Selfie = "selfie",
    UtilityBill = "utility_bill"
}
export declare enum DocumentSubtype {
    DriversLicense = "drivers_license",
    Passport = "passport",
    StateId = "state_id",
    SsnCard = "ssn_card",
    Other = "other"
}
export declare enum DocumentStatus {
    Pending = "pending",
    Approved = "approved",
    Rejected = "rejected"
}
export declare enum Currency {
    USD = "USD",
    EUR = "EUR",
    GBP = "GBP",
    NGN = "NGN"
}
