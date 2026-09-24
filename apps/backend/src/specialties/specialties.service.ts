import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { parseDate } from '../common/utils/dates';
import { AuthUser } from '../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSpecialtyDto, UpdateSpecialtyDto } from './dto/specialty.dto';

@Injectable()
export class SpecialtiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.specialty.findMany({
      orderBy: [{ code: 'asc' }, { qualification: 'asc' }],
      include: { _count: { select: { programs: true } } },
    });
  }

  async get(id: string) {
    const s = await this.prisma.specialty.findUnique({ where: { id }, include: { programs: true } });
    if (!s) throw new NotFoundException('Специальность не найдена');
    return s;
  }

  async create(dto: CreateSpecialtyDto, actor: AuthUser) {
    const created = await this.prisma.specialty.create({
      data: { ...dto, fgosDate: dto.fgosDate ? parseDate(dto.fgosDate) : null },
    });
    await this.audit.log(actor.id, 'CREATE', 'Specialty', created.id, null, created);
    return created;
  }

  async update(id: string, dto: UpdateSpecialtyDto, actor: AuthUser) {
    const before = await this.get(id);
    const updated = await this.prisma.specialty.update({
      where: { id },
      data: {
        ...dto,
        fgosDate: dto.fgosDate === undefined ? undefined : dto.fgosDate ? parseDate(dto.fgosDate) : null,
      },
    });
    await this.audit.log(actor.id, 'UPDATE', 'Specialty', id, before, updated);
    return updated;
  }

  async remove(id: string, actor: AuthUser) {
    const s = await this.get(id);
    if (s.programs.length > 0) {
      throw new ConflictException('Нельзя удалить специальность, по которой есть образовательные программы');
    }
    await this.prisma.specialty.delete({ where: { id } });
    await this.audit.log(actor.id, 'DELETE', 'Specialty', id, s, null);
    return { success: true };
  }
}
