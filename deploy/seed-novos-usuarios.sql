-- Novos usuários padrão (psicólogo + secretária).
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente (não duplica).
-- Senhas iniciais: psicologo123 / secretaria123 (hash bcrypt, 10 rounds).
-- Recomende a troca no primeiro acesso (Usuários → Senha).
insert into users ("user", name, role, pass, active) values
  ('psicologo', 'Psicólogo', 'psico', '$2b$10$YouxUyvDCekNozgfHybjkONenlw9EzVaK9d0s8qiBqHB67ULwRxxi', true),
  ('secretaria', 'Secretária', 'tecnico', '$2b$10$S4.rLpnjrx.bz1STCSGvpuDAuk.UPKmexOcl2iO/yJG5Y79DwpdHe', true)
on conflict ("user") do nothing;
-- Se o psicologo já existia com senha/perfil antigos, rode reset-senha-psicologo.sql.
