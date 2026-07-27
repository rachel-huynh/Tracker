-- ============================================================================
-- ĐỒNG BỘ REALTIME CHO APP QUẢN LÝ THU – CHI TÀI CHÍNH CÔNG ĐOÀN (CĐCS Plaza)
-- Chạy 1 lần trong Supabase → SQL Editor → New query → Paste → Run.
--
-- AN TOÀN: file này CHỈ tạo mới (create if not exists) các bảng tên cd_*.
--          KHÔNG có lệnh drop/xóa nào. Không đụng tới dữ liệu Legal Portal.
-- Chạy lại nhiều lần cũng không sao (idempotent).
-- ============================================================================

-- 1) PHIẾU THU / CHI / TẠM ỨNG / HOÀN ỨNG -----------------------------------
create table if not exists public.cd_phieu (
  id          text primary key,
  loai        text not null,          -- PT | PC | PU | HU
  so          text,                   -- số phiếu, vd "PC 79/2026"
  ngay        date,
  nguoi       text,
  bo_phan     text,
  dia_chi     text,
  dien_giai   text,
  so_tien     bigint  default 0,
  bang_chu    text,
  ma_so       text,                   -- mã mục (22,23,...,33,49)
  tai_khoan   text,
  hinh_thuc   text,                   -- TM | CK
  no_tk       text,
  co_tk       text,
  pu_ref      text,                   -- id phiếu tạm ứng (với phiếu hoàn ứng)
  has_files   boolean default false,
  created_at  timestamptz,
  updated_at  timestamptz default now(),
  updated_by  text
);
create index if not exists cd_phieu_ngay_idx on public.cd_phieu (ngay);
create index if not exists cd_phieu_loai_idx on public.cd_phieu (loai);
create index if not exists cd_phieu_ma_so_idx on public.cd_phieu (ma_so);

-- 2) ỦY NHIỆM CHI ------------------------------------------------------------
create table if not exists public.cd_unc (
  id          text primary key,
  so          text,
  ngay        date,
  tra_ten     text,
  tra_stk     text,
  tra_nh      text,
  nhan_ten    text,
  nhan_stk    text,
  nhan_nh     text,
  so_tien     bigint  default 0,
  bang_chu    text,
  noi_dung    text,
  pc_ref      text,
  has_files   boolean default false,
  created_at  timestamptz,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- 3) DANH SÁCH THĂM VIẾNG ĐOÀN VIÊN (hạn mức 3.000.000 đ/người/năm) ---------
create table if not exists public.cd_tham_vieng (
  id          text primary key,
  ho_ten      text,
  bo_phan     text,
  nam         integer,
  tham_benh   bigint default 0,
  tham_vieng  bigint default 0,
  mung_cuoi   bigint default 0,
  thai_san    bigint default 0,
  ghi_chu     text,
  updated_at  timestamptz default now(),
  updated_by  text
);
create index if not exists cd_tham_vieng_nam_idx on public.cd_tham_vieng (nam);

-- 4) CÁC BẢNG DỮ LIỆU DẠNG KHÓA – GIÁ TRỊ -----------------------------------
--    org      : thông tin đơn vị + chữ ký
--    sodu     : số dư đầu kỳ từng năm
--    chitieu  : chỉ tiêu cơ bản mục A báo cáo B07/TLĐ
--    kpdp:2026    : bảng kê nộp kinh phí & đoàn phí năm 2026
--    phucap:2026-1: bảng kê phụ cấp cán bộ CĐ quý I/2026
create table if not exists public.cd_kv (
  k           text primary key,
  v           jsonb,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- 5) FILE ĐÍNH KÈM (ảnh/chứng từ của phiếu & ủy nhiệm chi) ------------------
--    Tách riêng để bảng phiếu nhẹ, realtime không phải tải ảnh base64.
create table if not exists public.cd_file (
  id          text primary key,       -- <id phiếu>#<số thứ tự>
  owner_id    text not null,
  ten         text,
  loai        text,
  data        text,                   -- data URI base64
  created_at  timestamptz default now()
);
create index if not exists cd_file_owner_idx on public.cd_file (owner_id);

-- 6) RLS + QUYỀN -------------------------------------------------------------
-- App công đoàn KHÔNG có đăng nhập (theo yêu cầu ban đầu): ai có URL + API key
-- publishable thì đọc/ghi được. Vì vậy KHÔNG dán API key vào file HTML trên
-- GitHub Pages — mỗi máy tự nhập 1 lần trong màn hình Cài đặt.
do $$
declare t text;
begin
  foreach t in array array['cd_phieu','cd_unc','cd_tham_vieng','cd_kv','cd_file'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_all', t);
  end loop;
end $$;

-- 7) BẬT REALTIME cho 4 bảng dữ liệu (không cần realtime cho cd_file) -------
do $$
declare t text;
begin
  foreach t in array array['cd_phieu','cd_unc','cd_tham_vieng','cd_kv'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 8) KIỂM TRA ----------------------------------------------------------------
select table_name,
       (select count(*) from pg_publication_tables p
         where p.pubname='supabase_realtime' and p.schemaname='public'
           and p.tablename=t.table_name) as realtime_on
from information_schema.tables t
where table_schema='public' and table_name like 'cd\_%'
order by table_name;
