-- sms_followups pointed at Zoho tasks. It now points at lead_tasks.
--
-- Additive on purpose: zoho_task_id is left in place holding its historical
-- values so an in-flight follow-up scheduled before the cutover can still be
-- traced. Nothing reads it any more. Drop it once the Zoho account is closed.

alter table sms_followups add column if not exists crm_task_id uuid;

create index if not exists sms_followups_crm_task_id_idx
  on sms_followups (crm_task_id)
  where crm_task_id is not null;

select count(*) as scheduled_followups_carrying_a_zoho_task
from sms_followups
where status = 'scheduled' and zoho_task_id is not null;
