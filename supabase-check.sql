select
  'profiles' as item,
  to_regclass('public.profiles') is not null as ok
union all
select
  'operations',
  to_regclass('public.operations') is not null
union all
select
  'operation_events',
  to_regclass('public.operation_events') is not null
union all
select
  'message_queue',
  to_regclass('public.message_queue') is not null
union all
select
  'monthly_operation_stats',
  to_regclass('public.monthly_operation_stats') is not null
union all
select
  'apply_operation_event',
  to_regprocedure('public.apply_operation_event()') is not null
union all
select
  'enqueue_operation_message',
  to_regprocedure('public.enqueue_operation_message()') is not null;

select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'operations' and column_name in ('risk_percent', 'lot_size', 'remaining_lot_size', 'pip_value_account', 'result_amount'))
    or (table_name = 'operation_events' and column_name in ('lot_size', 'remaining_lot_size', 'amount'))
  )
order by table_name, column_name;

select
  email,
  role,
  created_at
from public.profiles
order by created_at desc;
