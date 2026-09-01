-- CreateEnum
CREATE TYPE "WireBeneficiaryType" AS ENUM ('local', 'international');

-- CreateTable
CREATE TABLE "WireBeneficiary" (
  "id"                 UUID                 NOT NULL,
  "type"               "WireBeneficiaryType" NOT NULL,
  "name"               TEXT                 NOT NULL,
  "bankName"           TEXT                 NOT NULL,
  "routingNumber"      TEXT,
  "accountNumber"      TEXT,
  "swiftBic"           TEXT,
  "iban"               TEXT,
  "country"            TEXT,
  "beneficiaryAddress" TEXT,
  "notes"              TEXT,
  "createdByUserId"    UUID                 NOT NULL,
  "createdAt"          TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)         NOT NULL,
  "archivedAt"         TIMESTAMP(3),

  CONSTRAINT "WireBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WireBeneficiary_type_idx" ON "WireBeneficiary"("type");
CREATE INDEX "WireBeneficiary_routingNumber_accountNumber_idx"
  ON "WireBeneficiary"("routingNumber", "accountNumber");
CREATE INDEX "WireBeneficiary_swiftBic_iban_idx"
  ON "WireBeneficiary"("swiftBic", "iban");
