import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Некорректный запрос',
  401: 'Требуется авторизация',
  403: 'Недостаточно прав для выполнения операции',
  404: 'Ресурс не найден',
  409: 'Конфликт данных',
  413: 'Слишком большой запрос',
  422: 'Ошибка валидации данных',
  429: 'Слишком много запросов, попробуйте позже',
  500: 'Внутренняя ошибка сервера',
  503: 'Сервис временно недоступен',
};

/** Английские сообщения NestJS/Express по умолчанию, которые нужно заменить на русские */
const ENGLISH_DEFAULTS = [
  /^Unauthorized$/i,
  /^Forbidden( resource)?$/i,
  /^Not Found$/i,
  /^Bad Request$/i,
  /^Conflict$/i,
  /^Internal server error$/i,
  /^Cannot (GET|POST|PUT|PATCH|DELETE) /i,
  /^Payload Too Large$/i,
  /^Too Many Requests$/i,
];

export interface ErrorBody {
  statusCode: number;
  message: string;
  errors?: string[];
  details?: unknown;
}

/**
 * Единый формат ошибок API с сообщениями на русском языке.
 * Ошибки Prisma преобразуются в понятные пользователю сообщения.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      let message: string = DEFAULT_MESSAGES[status] ?? 'Ошибка';
      let errors: string[] | undefined;
      let details: unknown;
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>;
        if (Array.isArray(r.message)) {
          errors = r.message.map(String);
          message = errors[0] ?? message;
        } else if (typeof r.message === 'string') {
          message = r.message;
        }
        if (Array.isArray(r.errors)) {
          errors = r.errors.map(String);
        }
        if (r.details !== undefined) {
          details = r.details;
        }
      }
      if (/^Validation failed \(uuid/i.test(message)) {
        message = 'Некорректный идентификатор записи';
      } else if (/^Validation failed \(numeric/i.test(message)) {
        message = 'Ожидается числовое значение';
      } else if (ENGLISH_DEFAULTS.some((re) => re.test(message))) {
        message = DEFAULT_MESSAGES[status] ?? message;
      }
      return { statusCode: status, message, errors, details };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Некорректные данные запроса к базе данных' };
    }
    if (exception instanceof SyntaxError && 'body' in (exception as object)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Некорректный JSON в теле запроса' };
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: DEFAULT_MESSAGES[500] };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): ErrorBody {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `Запись с такими значениями уже существует${fields ? ` (${fields})` : ''}`,
        };
      }
      case 'P2025':
        return { statusCode: HttpStatus.NOT_FOUND, message: 'Запись не найдена' };
      case 'P2003':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Операция невозможна: запись связана с другими данными',
        };
      case 'P2014':
        return { statusCode: HttpStatus.CONFLICT, message: 'Операция нарушает связь между записями' };
      default:
        return { statusCode: HttpStatus.BAD_REQUEST, message: `Ошибка базы данных (${e.code})` };
    }
  }
}
