# 2. Схема базы данных

PostgreSQL 16, схема описана в `apps/backend/prisma/schema.prisma` (32 модели, 21 перечисление), изменения
применяются миграциями Prisma (`apps/backend/prisma/migrations`). В CI проверяется, что схема совпадает с миграциями.

## Диаграмма связей

```mermaid
erDiagram
  Organization ||--|| OrganizationSettings : "настройки"
  Organization ||--o{ LessonTime : "звонки"
  Organization ||--o{ User : ""
  Organization ||--o{ Teacher : ""
  Organization ||--o{ Classroom : ""
  Organization ||--o{ EducationalProgram : ""
  Specialty ||--o{ EducationalProgram : ""
  EducationalProgram ||--o{ AcademicYear : ""
  EducationalProgram ||--o{ Semester : ""
  AcademicYear ||--o{ Semester : ""
  EducationalProgram ||--o{ CurriculumCycle : ""
  CurriculumCycle ||--o{ CurriculumItem : ""
  CurriculumItem ||--o{ CurriculumItem : "ПМ → МДК, практики"
  CurriculumItem ||--o{ SemesterCurriculumItem : "часы по семестрам"
  Semester ||--o{ SemesterCurriculumItem : ""
  EducationalProgram ||--o{ StudentGroup : ""
  StudentGroup ||--o{ Subgroup : ""
  StudentGroup ||--o{ Student : ""
  Subgroup ||--o{ Student : ""
  StudentGroup ||--o{ GroupCurriculumAssignment : "нагрузка"
  SemesterCurriculumItem ||--o{ GroupCurriculumAssignment : ""
  Teacher ||--o{ GroupCurriculumAssignment : ""
  Teacher ||--o{ TeacherAvailability : ""
  Teacher ||--o{ TeacherAvailabilityRule : "гибкие правила"
  Classroom ||--o{ ClassroomAvailability : ""
  EducationalProgram ||--o{ CalendarEvent : "график"
  StudentGroup ||--o{ AssessmentEvent : "экзамены, зачёты"
  Semester ||--o{ SchedulePeriod : ""
  SchedulePeriod ||--o{ ScheduleLesson : ""
  SchedulePeriod ||--o{ ScheduleGenerationJob : ""
  SchedulePeriod ||--o{ ValidationResult : ""
  StudentGroup ||--o{ ScheduleLesson : ""
  SemesterCurriculumItem ||--o{ ScheduleLesson : ""
  Teacher ||--o{ ScheduleLesson : ""
  Classroom ||--o{ ScheduleLesson : ""
  ScheduleLesson ||--o| ConductedLesson : "факт"
  ScheduleLesson ||--o{ ScheduleLesson : "перенос: исходное → новое"
  ScheduleLesson ||--o{ TeacherSubstitution : "замены"
  ScheduleLesson ||--o{ MakeupTask : "отработка"
  User ||--o{ Notification : ""
  User ||--o{ AuditLog : ""
```

## Сущности

### Организация и доступ

| Модель | Назначение | Ключевые поля |
| --- | --- | --- |
| `Organization` | Образовательная организация (колледж, вуз, филиал — СПО и ВО вместе) | `name`, `shortName`, `timezone` |
| `OrganizationSettings` | Правила расписания | `academicHoursPerLesson` (2), `lessonsPerDay`, `maxGroupLessonsPerDay`, `maxSameDisciplinePerDay/Week`, `lateLessonNumber`, `workingDays`, лимиты окон и экзаменов, `scheduleConsultations`, `solverTimeLimitSeconds`, `solverWeightsJson` |
| `LessonTime` | Расписание звонков | `lessonNumber`, `startTime`, `endTime` |
| `User` | Учётная запись | `email`, `passwordHash`, `role`, `teacherId` (для преподавателя), `studentGroupId` (для студента), `refreshTokenHash` |
| `AuditLog` | Журнал изменений | `action`, `entityType`, `entityId`, `oldDataJson`, `newDataJson` |
| `Notification` | Уведомления | `type`, `title`, `message`, `scheduleLessonId`, `isRead` |

### Учебный план

| Модель | Назначение | Ключевые поля |
| --- | --- | --- |
| `Specialty` | Специальность СПО или направление подготовки ВО | `code` (09.02.07, 40.03.01), `name`, `qualification`, `educationLevel` (SPO, BACHELOR, SPECIALIST, MASTER, POSTGRADUATE — по умолчанию по второму сегменту кода), `durationMonths` |
| `EducationalProgram` | Учебный план набора | `admissionYear`, `studyForm` (очная, очно-заочная, заочная), `durationMonths`, `totalSemesters` (до 14), `status` |
| `AcademicYear` | Учебный год (курс) | `title`, `courseNumber`, `startDate`, `endDate` |
| `Semester` | Семестр | `number`, `courseNumber`, даты, недели теории/аттестации/практики/каникул |
| `CurriculumCycle` | Цикл СПО (СГ, ОП, ПМ…) или блок/модуль ВО (Б1, Б1.О.05, Б2, ФТД…) | `code`, `name`, `sortOrder` |
| `CurriculumItem` | Дисциплина, ПМ, МДК, практика, ГИА | `code`, `name`, `itemType`, `parentItemId` (иерархия ПМ → МДК), `isRequired` (false — дисциплина по выбору или факультатив: ставится в расписание только группам с назначенной нагрузкой), `isDifficult` |
| `CurriculumScan` | Скан учебного плана | `fileNames[]`, `status` (PROCESSING, READY, FAILED, APPLIED), `progress`, `message`, `error`, `resultJson` (распознанные данные), `programId` (созданный план) |
| `SemesterCurriculumItem` | Часы элемента в семестре | `lectureHours`, `practicalHours`, `laboratoryHours`, `consultationHours`, `selfStudyHours`, `assessmentHours`, `practiceHours`, рассчитанные `planned*Lessons`, `controlForm`, `practiceAtCollege`, `scheduleConsultations`, допустимые типы аудиторий по видам занятий |

### Контингент, кадры, аудитории

| Модель | Назначение | Ключевые поля |
| --- | --- | --- |
| `StudentGroup` | Учебная группа | `code`, `courseNumber`, `currentSemesterNumber`, `studentCount`, `subgroupCount`, режим занятий: `studyDays[]` (учебные дни, пусто — все), `firstLessonNumber`/`lastLessonNumber` (допустимые пары: вторая смена, вечерние и очно-заочные группы) |
| `Subgroup` | Подгруппа | `number`, `name`, `studentCount` |
| `Student` | Студент | `fullName`, `recordBookNumber`, `subgroupId` |
| `Teacher` | Преподаватель | `department`, `maxWeeklyLessons`, `maxDailyLessons`, `preferredStartLesson/EndLesson` |
| `TeacherAvailability` | Недоступность и предпочтения | `weekday`, `lessonNumber`, `isAvailable`, `preferenceWeight` (−10…10), `reason` |
| `TeacherAvailabilityRule` | Гибкие правила доступности | `kind` (UNAVAILABLE, AVAILABLE_ONLY, PREFERRED, UNDESIRED, ONLINE), `weekdays[]`, `lessonNumbers[]`, `timeFrom`/`timeTo`, `parity` (ANY, ODD, EVEN — по неделям учебного года), `monthWeeks[]` (1–5, −1 — последний день недели месяца), `validFrom`/`validTo`, `weight`, `note` |
| `Classroom` | Аудитория | `code`, `building`, `capacity`, `classroomType`, `equipmentJson` |
| `ClassroomAvailability` | Недоступность аудитории | `weekday`, `lessonNumber`, `isAvailable` |
| `GroupCurriculumAssignment` | Нагрузка: кто и как ведёт | `lessonType` (null — все виды), `subgroupNumber` (null — вся группа), `teacherId`, `weeklyLessonTarget`, `priority`, `preferredClassroomId`, `classroomTypes`, `streamKey` (поток), `allowHoursExcess` |

### Календарный график

| Модель | Назначение | Ключевые поля |
| --- | --- | --- |
| `CalendarEvent` | Период графика | `eventType` (теория, аттестация, каникулы, практики, ГИА, праздник…), даты, область действия (`educationalProgramId`, `courseNumber`, `studentGroupId`, `teacherId`; без них — вся организация), `blocksSchedule`; у заочной формы межсессионные периоды — блокирующие события «Прочее» |
| `AssessmentEvent` | Экзамен, зачёт | `controlForm`, `date`, `lessonNumber`, `teacherId`, `classroomId` |

### Расписание и факт

| Модель | Назначение | Ключевые поля |
| --- | --- | --- |
| `SchedulePeriod` | Период расписания (неделя, месяц, семестр) | даты, `status` (черновик → сгенерировано → опубликовано → архив), `publishedAt` |
| `ScheduleLesson` | Занятие | `date`, `lessonNumber`, время, группа, `subgroupNumber`, дисциплина семестра, `lessonType`, преподаватель, аудитория, `status`, `academicHours` (2 или 1 для неполной пары), `originalLessonId` (перенос), `streamKey`, `isManual`, `isLocked`, `generationJobId` |
| `ConductedLesson` | Отметка о проведении | `status` (проведено, отменено, перенесено, замена), `actualHours`, `actualTeacherId`, `actualClassroomId`, `cancellationReason`, `replacementLessonId` |
| `TeacherSubstitution` | Замена преподавателя | исходный и заменяющий преподаватель, причина, кто утвердил |
| `MakeupTask` | «Требуется отработка» | исходное занятие, группа, подгруппа, дисциплина, вид, часы, статус, занятие-отработка |
| `ScheduleGenerationJob` | Задание генерации | `status`, `mode`, параметры, прогресс, решатель, результат (предпросмотр), статистика, ошибки; `periodIds[]` — все периоды совместной генерации для всех групп (`schedulePeriodId` — первый из них) |
| `ValidationResult` | Результат проверки | `severity` (ошибка, предупреждение, информация), `validationType`, объект, сообщение, детали |

## Правила целостности

- Уникальность: код специальности + квалификация; код элемента в учебном плане; номер семестра в плане; шифр группы;
  номер подгруппы в группе; номер аудитории в организации; строка часов «элемент × семестр»; слот доступности.
- Каскадное удаление подчинённых данных плана и расписания; ссылки на преподавателя и аудиторию в занятиях при
  удалении обнуляются (`SetNull`), но сервисы запрещают удаление, если есть занятия, — предлагается деактивация.
- Индексы по датам и сущностям занятий (`date + lessonNumber`, группа/преподаватель/аудитория + дата) обеспечивают
  быструю проверку конфликтов.
- Даты хранятся как `DATE` (без времени), время пар — строками `HH:MM` по сетке звонков.
