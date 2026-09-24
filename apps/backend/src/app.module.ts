import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AssignmentsModule } from './assignments/assignments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExportModule } from './export/export.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health/health.controller';
import { HourControlModule } from './hour-control/hour-control.module';
import { PlanningModule } from './planning/planning.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgramsModule } from './programs/programs.module';
import { ReportsModule } from './reports/reports.module';
import { ScheduleModule } from './schedule/schedule.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SettingsModule } from './settings/settings.module';
import { SpecialtiesModule } from './specialties/specialties.module';
import { TeachersModule } from './teachers/teachers.module';
import { UsersModule } from './users/users.module';
import { ValidationModule } from './validation/validation.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    SettingsModule,
    PlanningModule,
    NotificationsModule,
    ValidationModule,
    AuthModule,
    UsersModule,
    SpecialtiesModule,
    ProgramsModule,
    GroupsModule,
    TeachersModule,
    ClassroomsModule,
    AssignmentsModule,
    CalendarModule,
    ScheduleModule,
    SchedulerModule,
    HourControlModule,
    ReportsModule,
    ExportModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
