import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/** Achata os erros do class-validator em { campo: [mensagens] }. */
function flatten(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    Object.assign(out, flatten(e.children ?? [], path));
  }
  return out;
}

/**
 * whitelist + forbidNonWhitelisted: campos que não estão no DTO geram 400
 * (impede, por exemplo, um cliente mandar "role": "ADMIN" no corpo).
 * transform: converte query strings em number/Date conforme o DTO.
 */
export const appValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) =>
    new BadRequestException({ message: 'Dados inválidos', errors: flatten(errors) }),
});
