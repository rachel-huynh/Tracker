-- ============================================================================
-- ĐỒNG BỘ TỰ ĐỘNG CHO SSP BUDGET TRACKER (dự án cải tạo Sofitel Saigon Plaza)
-- Chạy 1 lần: Supabase → SQL Editor → New query → dán toàn bộ → Run.
--
-- AN TOÀN: file này CHỈ tạo mới (create if not exists) 2 bảng tên bt_*.
--          KHÔNG có lệnh drop/xóa nào — không đụng tới dữ liệu Công đoàn (cd_*)
--          hay Legal Portal. Chạy lại nhiều lần cũng không sao (idempotent).
--
-- Mô hình: mỗi "mẩu dữ liệu" (1 phiên bản dự toán, 1 phương án VE, 1 hợp đồng,
-- sổ thanh toán…) là 1 dòng trong bt_doc (nhẹ, có realtime) + 1 dòng trong
-- bt_blob (nội dung đầy đủ, nén gzip, KHÔNG realtime).
-- Nhờ tách 2 bảng, tín hiệu realtime luôn nhỏ dù phiên bản dự toán rất lớn.
-- ============================================================================

-- 1) CHỈ MỤC NHẸ — có realtime ----------------------------------------------
create table if not exists public.bt_doc (
  key         text primary key,      -- 'settings' | 'ver:<id>' | 'opt:<id>' | 'con:<id>' | 'payments' | ...
  kind        text,                  -- settings | version | option | area | contract | quote | payments | map | att
  label       text,                  -- tên dễ đọc (chỉ để xem trong Supabase)
  sig         text,                  -- chữ ký nội dung, để phát hiện thay đổi
  bytes       integer default 0,
  updated_at  timestamptz default now(),
  updated_by  text                   -- mã máy đã ghi (chống vòng lặp realtime)
);
create index if not exists bt_doc_kind_idx on public.bt_doc (kind);

-- 2) NỘI DUNG ĐẦY ĐỦ — không realtime ---------------------------------------
create table if not exists public.bt_blob (
  key         text primary key,
  enc         text default 'plain',  -- plain | gzip (base64)
  payload     text,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- 3) QUYỀN TRUY CẬP ----------------------------------------------------------
-- App không có đăng nhập nên dùng khóa publishable (anon). Chỉ đặt file HTML ở
-- nơi nội bộ (OneDrive công ty) — KHÔNG đăng lên web công khai.
do $$
declare t text;
begin
  foreach t in array array['bt_doc','bt_blob'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_all', t);
  end loop;
end $$;

-- 4) BẬT REALTIME — chỉ cho bt_doc (bt_blob cố tình KHÔNG bật) ---------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bt_doc'
  ) then
    alter publication supabase_realtime add table public.bt_doc;
  end if;
end $$;

-- 5) KIỂM TRA ----------------------------------------------------------------
select t.table_name,
       (select count(*) from pg_publication_tables p
         where p.pubname='supabase_realtime' and p.schemaname='public'
           and p.tablename=t.table_name) as realtime_on
from information_schema.tables t
where t.table_schema='public' and t.table_name like 'bt\_%'
order by t.table_name;
