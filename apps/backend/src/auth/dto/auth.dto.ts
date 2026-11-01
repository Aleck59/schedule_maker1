import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'dispatcher@college.ru' })
  @IsEmail({}, { message: 'Укажите корректный email' })
  email: string;

  @ApiProperty({ example: 'Dispatcher123!' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите пароль' })
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Не передан токен обновления' })
  refreshToken: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'teacher2@college.ru' })
  @IsEmail({}, { message: 'Укажите корректный email' })
  email: string;

  @ApiProperty({ example: 'Secret123!' })
  @IsString()
  @MinLength(8, { message: 'Пароль должен содержать не менее 8 символов' })
  password: string;

  @ApiProperty({ example: 'Иванов Иван Иванович' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите ФИО' })
  fullName: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole, { message: 'Недопустимая роль' })
  role: UserRole;

  @ApiPropertyOptional({ description: 'Для роли TEACHER — карточка преподавателя' })
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'Для роли STUDENT — учебная группа' })
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;
}
