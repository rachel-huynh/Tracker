-- ============================================================================
-- ĐỐI CHIẾU HÓA ĐƠN ĐẦU VÀO (DoiChieuHoaDon.html) — lược đồ Supabase
-- Chạy 1 lần trong Supabase → SQL Editor → New query → Paste → Run.
--
-- AN TOÀN: file này CHỈ tạo mới (create if not exists) các bảng tên hd_*.
--          KHÔNG có lệnh drop bảng/xóa dữ liệu. Không đụng tới bảng của app khác.
--          Chạy lại nhiều lần cũng không sao (idempotent).
--
-- BẢO MẬT: app bắt buộc ĐĂNG NHẬP (Supabase Auth, email + mật khẩu).
--   RLS chỉ cho vai trò "authenticated" — ai chỉ có API key mà không có tài khoản
--   thì KHÔNG đọc/ghi được bảng hd_*.
--   ⚠️ Nhớ TẮT tự đăng ký: Authentication → Sign In / Providers → Email →
--      bỏ chọn "Allow new users to sign up". Tạo 3 tài khoản kế toán tại
--      Authentication → Users → Add user (tích "Auto Confirm User").
-- ============================================================================

-- 1) HÓA ĐƠN TỪ CỔNG hoadondientu.gdt.gov.vn (đã hợp nhất 6 file) ------------
--    id = <MST người bán>|<ký hiệu 6 ký tự>|<số HĐ không số 0 đầu>  (duy nhất)
create table if not exists public.hd_portal (
  id              text primary key,
  ky              text not null,          -- kỳ YYYY-MM (theo ngày lập)
  nguon           text,                   -- HDDT | MTT
  kqkt            text,                   -- kết quả kiểm tra
  khmau           text,                   -- ký hiệu mẫu số (1/2/…)
  khhd            text,                   -- ký hiệu hóa đơn (C26TAA)
  so_hd           text,
  ngay            date,
  mst_nb          text,
  ten_nb          text,
  tien_chua_thue  numeric,                -- null = cổng thuế để trống
  tien_thue       numeric,
  chiet_khau      numeric,
  tong_tt         numeric,
  tien_te         text,
  trang_thai      text,                   -- Hóa đơn mới / điều chỉnh / thay thế / …
  hd_goc          text,                   -- tham chiếu HĐ gốc (khi có)
  lan_dau         int,                    -- lần tải đầu tiên thấy HĐ (1|2)
  lan_cuoi        int,
  file_ten        text,
  updated_at      timestamptz default now(),
  updated_by      text
);
create index if not exists hd_portal_ky_idx  on public.hd_portal (ky);
create index if not exists hd_portal_mst_idx on public.hd_portal (mst_nb);

-- 2) TỜ KHAI NỘI BỘ (bảng kê mua vào) — đã gộp các dòng nhiều thuế suất ------
create table if not exists public.hd_tk (
  id              text primary key,       -- <kỳ>|<khóa HĐ>  hoặc <kỳ>|x|… nếu dòng không có số HĐ
  ky              text not null,
  khoa            text,                   -- khóa ghép với hd_portal.id (null nếu thiếu số HĐ)
  khmau           text,
  khhd            text,
  so_hd           text,
  ngay            date,
  mst_nb          text,
  ten_nb          text,
  mat_hang        text,
  thue_suat       text,
  tien_chua_thue  numeric,
  tien_thue       numeric,
  so_dong         int default 1,
  dong_excel      text,                   -- số dòng trong file Excel gốc
  file_ten        text,
  updated_at      timestamptz default now(),
  updated_by      text
);
-- 2026-09-24: mỗi tháng 2 tờ khai (SSP = Sofitel Saigon Plaza, CP = Central Plaza Office Building)
alter table public.hd_tk add column if not exists nguon_tk text;
create index if not exists hd_tk_ky_idx   on public.hd_tk (ky);
create index if not exists hd_tk_khoa_idx on public.hd_tk (khoa);

-- 3) DUYỆT / GHI CHÚ theo từng dòng (gối đầu qua các kỳ) ---------------------
--    id = "P:<hd_portal.id>" hoặc "T:<hd_tk.id>"
create table if not exists public.hd_review (
  id          text primary key,
  action      text,                       -- duyet | loai_tru | cho
  ghi_chu     text,
  history     jsonb default '[]'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- 4) TRẠNG THÁI KỲ: lần tải 1/2, tờ khai, chốt kỳ, ảnh chụp kết quả ---------
create table if not exists public.hd_ky (
  ky          text primary key,           -- YYYY-MM
  lan1_at     timestamptz, lan1_by text,
  lan2_at     timestamptz, lan2_by text,
  tk_at       timestamptz, tk_by   text, tk_file text,
  files       jsonb default '[]'::jsonb,  -- nhật ký các file đã nạp
  snap_lan1   jsonb,                      -- tóm tắt {at,by,n} — dữ liệu nằm ở hd_snap
  chot        boolean default false,
  chot_at     timestamptz, chot_by text,
  snap_chot   jsonb,                      -- tóm tắt {at,by,n} — dữ liệu nằm ở hd_snap
  updated_at  timestamptz default now(),
  updated_by  text
);

-- 4b) ẢNH CHỤP KẾT QUẢ ĐỐI CHIẾU (lần 1 / chốt kỳ) — bảng riêng, KHÔNG realtime
create table if not exists public.hd_snap (
  id          text primary key,           -- <kỳ>|lan1  hoặc  <kỳ>|chot
  ky          text not null,
  kind        text not null,
  at          timestamptz default now(),
  by_user     text,
  data        jsonb
);

-- 5) CÀI ĐẶT dạng khóa – giá trị (dung sai, …) -------------------------------
create table if not exists public.hd_kv (
  k           text primary key,
  v           jsonb,
  updated_at  timestamptz default now(),
  updated_by  text
);

-- 6) NHẬT KÝ THAO TÁC ---------------------------------------------------------
create table if not exists public.hd_log (
  id          bigserial primary key,
  at          timestamptz default now(),
  by_user     text,
  action      text,
  detail      jsonb
);
create index if not exists hd_log_at_idx on public.hd_log (at desc);

-- 7) RLS: chỉ người đã đăng nhập ---------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hd_portal','hd_tk','hd_review','hd_ky','hd_kv','hd_log','hd_snap'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_auth', t);
  end loop;
end $$;
grant usage, select on sequence public.hd_log_id_seq to authenticated;

-- 8) REALTIME: bảng nhỏ (kỳ, duyệt, cài đặt). Bảng hóa đơn lớn KHÔNG bật —
--    app nạp lại khi hd_ky của kỳ đó thay đổi (tín hiệu nhỏ, không nghẽn).
do $$
declare t text;
begin
  foreach t in array array['hd_ky','hd_review','hd_kv'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 9) KIỂM TRA ----------------------------------------------------------------
select table_name,
       (select count(*) from pg_publication_tables p
         where p.pubname='supabase_realtime' and p.schemaname='public'
           and p.tablename=t.table_name) as realtime_on
from information_schema.tables t
where table_schema='public' and table_name like 'hd\_%'
order by table_name;
