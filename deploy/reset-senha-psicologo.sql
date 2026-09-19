-- Redefine o acesso do psicólogo (vale mesmo se a conta já existir com outra senha).
-- Rode no SQL Editor do Supabase. Após rodar: login psicologo / senha psicologo123.
insert into users ("user", name, role, pass, active) values
  ('psicologo', 'Psicólogo', 'psico', '$2b$10$YouxUyvDCekNozgfHybjkONenlw9EzVaK9d0s8qiBqHB67ULwRxxi', true)
on conflict ("user") do update set
  name = excluded.name,
  role = excluded.role,
  pass = excluded.pass,
  active = true;

-- Confirmação (deve retornar 1 linha, SEM mostrar a senha):
select "user", name, role, active from users where "user" = 'psicologo';
