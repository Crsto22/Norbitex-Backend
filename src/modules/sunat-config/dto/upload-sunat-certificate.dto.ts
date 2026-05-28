import { IsString, MaxLength } from 'class-validator';

export class UploadSunatCertificateDto {
  @IsString()
  @MaxLength(255)
  certificatePassword: string;
}
