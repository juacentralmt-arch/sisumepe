const fs=require('fs');
let j=JSON.parse(fs.readFileSync('./db.json','utf8'));
let sql='';
sql+='-- Seed estoque massivo 60 dias - gerado em '+new Date().toISOString()+'\n';
sql+='-- TRUNCATE estoque_mov, estoque_serial CASCADE;\n';
sql+='-- UPDATE estoque SET saldo=0;\n\n';
sql+='-- Movimentacoes\n';
j.estoqueMov.forEach(m=>{
  const seriais = JSON.stringify(m.seriais||[]).replace(/'/g, "''");
  const unidade = String(m.unidade||'').replace(/'/g,"''");
  const motivo = String(m.motivo||'').replace(/'/g,"''");
  const user = String(m.user||'').replace(/'/g,"''");
  const userName = String(m.userName||'').replace(/'/g,"''");
  const dest = m.unidadeDestino ? `'${String(m.unidadeDestino).replace(/'/g,"''")}'` : 'NULL';
  sql+=`INSERT INTO estoque_mov (id, contrato, material, unidade, tipo, qtd, saldoantes, saldodepois, motivo, "user", username, seriais, unidadedestino, createdat) VALUES (${m.id}, '${m.contrato}', '${m.material}', '${unidade}', '${m.tipo}', ${m.qtd}, ${m.saldoAntes}, ${m.saldoDepois}, '${motivo}', '${user}', '${userName}', '${seriais}'::jsonb, ${dest}, '${m.createdAt}') ON CONFLICT (id) DO NOTHING;\n`;
});
sql+='\n-- Seriais\n';
j.estoqueSerial.forEach(s=>{
  const unidade = String(s.unidade).replace(/'/g,"''");
  sql+=`INSERT INTO estoque_serial (id, contrato, serial, unidade, status, createdat, updatedat) VALUES (${s.id}, '${s.contrato}', '${s.serial}', '${unidade}', '${s.status}', '${s.createdAt}', '${s.updatedAt}') ON CONFLICT (contrato, serial) DO NOTHING;\n`;
});
sql+='\n-- Saldos atuais\n';
j.estoque.forEach(e=>{
  const unidade = String(e.unidade).replace(/'/g,"''");
  sql+=`INSERT INTO estoque (id, contrato, material, unidade, saldo, createdat, updatedat) VALUES (${e.id}, '${e.contrato}', '${e.material}', '${unidade}', ${e.saldo}, '${e.createdAt}', '${e.updatedAt}') ON CONFLICT (contrato, material, unidade) DO UPDATE SET saldo=EXCLUDED.saldo, updatedat=EXCLUDED.updatedat;\n`;
});
sql+='\nSELECT setval(pg_get_serial_sequence(\'estoque_mov\',\'id\'), (SELECT max(id) FROM estoque_mov));\n';
sql+='SELECT setval(pg_get_serial_sequence(\'estoque_serial\',\'id\'), (SELECT max(id) FROM estoque_serial));\n';
sql+='SELECT setval(pg_get_serial_sequence(\'estoque\',\'id\'), (SELECT max(id) FROM estoque));\n';
fs.writeFileSync('deploy/seed-estoque-massivo.sql', sql);
console.log('SQL gerado', sql.length, 'bytes, movs', j.estoqueMov.length, 'seriais', j.estoqueSerial.length);
