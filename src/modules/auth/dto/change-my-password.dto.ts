import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangeMyPasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'La contrasena debe tener minimo 8 caracteres, mayuscula, minuscula y un numero.',
  })
  password: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmarPassword: string;
}
