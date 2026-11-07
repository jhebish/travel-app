-- Deleting an account removes everything tied to it: every user-owned table cascades from
-- auth.users. The one exception was app_config.updated_by (the admin who last changed the
-- source defaults), which would block deleting that admin's account. Clear it instead.
alter table public.app_config drop constraint if exists app_config_updated_by_fkey;
alter table public.app_config
  add constraint app_config_updated_by_fkey foreign key (updated_by) references auth.users (id) on delete set null;
