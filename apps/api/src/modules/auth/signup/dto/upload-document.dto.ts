import { IsIn, IsOptional } from 'class-validator';
import { DocumentSubtype, DocumentType } from '@prisma/client';

export class UploadDocumentDto {
  @IsIn(['id_front', 'id_back', 'selfie', 'utility_bill'])
  type!: DocumentType;

  @IsOptional()
  @IsIn(['drivers_license', 'passport', 'state_id', 'ssn_card', 'other'])
  subtype?: DocumentSubtype;
}
