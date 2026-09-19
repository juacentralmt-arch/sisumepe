-- Redefine o acesso do psicólogo (vale mesmo se a conta já existir com outra senha).
-- Rode no SQL Editor do Supabase. Após rodar: login psicologo / senha psicologo123.
-- Também corrige variante acentuada (psicólogo) caso exista.
insert into users ("user", name, role, pass, active) values
  ('psicologo', 'Psicólogo', 'psico', '$2b$10$YouxUyvDCekNozgfHybjkONenlw9EzVaK9d0s8qiBqHB67ULwRxxi', true)
on conflict ("user") do update set
  name = excluded.name,
  role = excluded.role,
  pass = excluded.pass,
  active = true;

-- Limpa variante acentuada antiga se existir (evita duplicata):
delete from users where "user" = 'psicólogo' and exists (select 1 from users where "user" = 'psicologo');

-- Confirmação (deve retornar 1 linha, SEM mostrar a senha):
select "user", name, role, active from users where "user" in ('psicologo','psicólogo');
