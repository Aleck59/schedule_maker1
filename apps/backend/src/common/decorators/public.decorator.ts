import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Эндпоинт доступен без авторизации */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
