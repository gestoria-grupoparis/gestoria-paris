-- Catálogos (razones sociales, sucursales, tipos de trámite), perfiles, alcances
-- y funciones de permiso base. Grants y RLS se definen en 20261027000700_rls.sql.

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  cuit text
);

create table public.sucursales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  provincia text not null
);

create table public.tipos_tramite (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  activo boolean not null default true
);

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('gerencia', 'contable', 'gestora', 'comercial', 'admin')),
  activo boolean not null default true
);

-- sucursal_id null = todas las sucursales de la empresa.
-- La PK no admite null, por eso la unicidad se garantiza con índices únicos parciales.
create table public.alcances (
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  sucursal_id uuid references public.sucursales (id)
);

create unique index alcances_empresa_entera_uq
  on public.alcances (perfil_id, empresa_id) where sucursal_id is null;
create unique index alcances_sucursal_uq
  on public.alcances (perfil_id, empresa_id, sucursal_id) where sucursal_id is not null;

-- Rol del perfil activo del usuario actual, o null (sin perfil o inactivo).
create function public.mi_rol() returns text
language sql stable security definer
set search_path = public
as $$
  select p.rol from public.perfiles p where p.id = auth.uid() and p.activo
$$;

-- true si el usuario actual (con perfil activo) tiene un alcance sobre la empresa
-- que cubra toda la empresa (sucursal_id null) o esa sucursal.
create function public.tiene_alcance(p_empresa uuid, p_sucursal uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.alcances a
      join public.perfiles p on p.id = a.perfil_id and p.activo
     where a.perfil_id = auth.uid()
       and a.empresa_id = p_empresa
       and (a.sucursal_id is null or a.sucursal_id = p_sucursal)
  )
$$;
