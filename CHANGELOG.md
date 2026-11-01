# Журнал изменений

Формируется автоматически по сообщениям коммитов (Conventional Commits).

## [1.2.1](https://github.com/Aleck59/schedule_maker1/compare/v1.2.0...v1.2.1) (2026-11-01)

### Исправления

* версия программы видна и при локальной сборке ([89a3f3a](https://github.com/Aleck59/schedule_maker1/commit/89a3f3a1d45846c293c43240717290db69b91bb8))

## [1.2.0](https://github.com/Aleck59/schedule_maker1/compare/v1.1.0...v1.2.0) (2026-11-01)

### Новые возможности

* **reports:** редактор форм отчётов «как в Excel» ([d35d101](https://github.com/Aleck59/schedule_maker1/commit/d35d10156c67255efcb2304898e4495f01489b74))

## [1.1.0](https://github.com/Aleck59/schedule_maker1/compare/v1.0.0...v1.1.0) (2026-11-01)

### Новые возможности

* постоянное расписание открывается из «Расписания», выбор вида в «Составлении» ([f5a9337](https://github.com/Aleck59/schedule_maker1/commit/f5a9337e8451d5b278d56f627ed965102b1abd34))

## 1.0.0 (2026-11-01)

### Новые возможности

* **backend:** NestJS API, Prisma schema, scheduling engine and demo seed ([79a3c45](https://github.com/Aleck59/schedule_maker1/commit/79a3c4578f3e93047998ce89803a6683e003a3dd))
* **backend:** модуль «Праздники» — справочник, переносы, производственный календарь ([c6cc174](https://github.com/Aleck59/schedule_maker1/commit/c6cc174d6fbc46101f62c4d1835a03414177582e))
* CP-SAT solver service, hour control, reports, exports and tests ([89fb066](https://github.com/Aleck59/schedule_maker1/commit/89fb06663c92e4830d1e765b33d24df1e7292d23))
* **curriculum:** import curriculum plan from a scanned PDF ([46b8356](https://github.com/Aleck59/schedule_maker1/commit/46b8356e5570b972fcea7bdb7c70cc2ae2d710b5))
* **engine:** run CP-SAT solver inside the backend image ([4e75178](https://github.com/Aleck59/schedule_maker1/commit/4e7517848cdd373b257c3aad34f9db44ef10b65e))
* **frontend:** React interface for scheduling, hour control and reference data ([a3cf7de](https://github.com/Aleck59/schedule_maker1/commit/a3cf7ded6dd20af7260b48487a59ac1a6523a02d))
* **frontend:** страница «Праздники» — календарь года, справочник, переносы, правила ([fc5adce](https://github.com/Aleck59/schedule_maker1/commit/fc5adce3a5a3610cbd8c88017dd5c38056e32929))
* **frontend:** тепловая карта — только из раздела «Аудитории», без отдельного пункта меню ([ac742b6](https://github.com/Aleck59/schedule_maker1/commit/ac742b6bbacd282b487fab4f5b1f8259d9fe5a5d))
* **generation:** simpler generation page, window polishing, never-worse CP-SAT ([9ef89db](https://github.com/Aleck59/schedule_maker1/commit/9ef89db83323712495fc4c2b0f15545c8d8733eb))
* higher education alongside SPO, schedule for all groups, digital PDF plans ([a3bb9b6](https://github.com/Aleck59/schedule_maker1/commit/a3bb9b62e7b9d78733c58beeed3772684945f9f8))
* **schedule:** suggest and apply fixes for schedule conflicts ([54dc8f5](https://github.com/Aleck59/schedule_maker1/commit/54dc8f5deaf024f802a0cd9d9d42d99771e09025))
* **setup:** guided setup wizard for the administrator ([02c6889](https://github.com/Aleck59/schedule_maker1/commit/02c68897f1f2a76d29b54903d9191b74a849d640))
* **solver:** scale CP-SAT to the whole organization and pick the best of two solvers ([457455d](https://github.com/Aleck59/schedule_maker1/commit/457455d5bee023e139ff23b741a76b552d98facc))
* **teachers:** flexible availability rules with time windows and online lessons ([f6c2f09](https://github.com/Aleck59/schedule_maker1/commit/f6c2f09bd70fa842c53ea7005ea28f80d1349b5f))
* **teachers:** tile page, qualification levels, mid-semester handover ([7f7761f](https://github.com/Aleck59/schedule_maker1/commit/7f7761f0d755934cd3f322cbbf905c4cdfc25b25))
* **ui:** calmer, denser interface across the app ([21b1e5b](https://github.com/Aleck59/schedule_maker1/commit/21b1e5bb724c791a04e5d8f4f8136234045b9cc6))
* **ui:** light, airy interface with subtle motion ([b7ed16b](https://github.com/Aleck59/schedule_maker1/commit/b7ed16bf211aa431a87a219a7e39d2f6b8fae3ca))
* **workload:** compact assignments table and faster teacher summary ([3394d07](https://github.com/Aleck59/schedule_maker1/commit/3394d0737b51f637fe038fe587bdf468afcc8863))
* быстрые исправления конфликтов, предпросмотр, фильтры групп, экзамены без накладок ([f079c54](https://github.com/Aleck59/schedule_maker1/commit/f079c5491a8bace5998dd6b607d9e0f592a6ee84))
* печатная форма расписания на неделю по специальности (PDF и Excel) ([4140c82](https://github.com/Aleck59/schedule_maker1/commit/4140c822b571f732a31f4dc874bf4d83c397e1c3))
* полный импорт учебного плана из файлов .plx и .xml (GosInsp, 1С:Университет) ([8183f7e](https://github.com/Aleck59/schedule_maker1/commit/8183f7e267020513c8e58af5a6a66e4fdcc00d15))
* постоянное расписание для руководства (типовая неделя) отдельно от рабочего ([f62bfc1](https://github.com/Aleck59/schedule_maker1/commit/f62bfc1f2568cd50da6e12b409ffbba56a22361c))
* потоки, автозачёт пар, отработка после отсутствия и равномерное распределение по неделям ([c2bbc83](https://github.com/Aleck59/schedule_maker1/commit/c2bbc832a39fdf7615a3feeb5d2484cf2ea7ea4e))
* расстановка по максимуму — тумблер генерации без непоставленных пар ([31acd1c](https://github.com/Aleck59/schedule_maker1/commit/31acd1c52fd71b8c586bf5c95e756083de19099c))

### Исправления

* **calendar:** count only own academic year days in boundary weeks ([9ba394b](https://github.com/Aleck59/schedule_maker1/commit/9ba394bed832c25befec81e1aae379037efa8c88))
* **frontend:** reset group on period change, truncate long select values ([2eaa82d](https://github.com/Aleck59/schedule_maker1/commit/2eaa82df4e1e32e5a524c38ad08b6063cc0279eb))
* **solver:** разбор .plx по структуре реального файла «Учебные планы» 4.x ([88c771e](https://github.com/Aleck59/schedule_maker1/commit/88c771e79ae3d0f0602d5ce0cbe8cb63ac68c57f))
