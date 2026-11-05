// =====================================================================
//  Validação de entrada com Zod (borda da API).
//  Regras de negócio continuam nas rotas; aqui garantimos tipo, tamanho
//  e formato antes de qualquer acesso ao banco.
// =====================================================================
const { z } = require('zod');

const text = (max, label) => z.string({ error: `${label} inválido` }).trim().max(max, `${label} muito longo`);
const optionalText = (max, label) => text(max, label).optional().or(z.literal(''));

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const raw = source === 'query' ? req.query : source === 'params' ? req.params : (req.body || {});
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => ({
        field: i.path.join('.') || '(raiz)',
        message: i.message
      }));
      return res.status(400).json({
        error: issues.length ? `${issues[0].field}: ${issues[0].message}` : 'Dados inválidos',
        issues
      });
    }
    if (source === 'query') req.validatedQuery = parsed.data;
    else if (source === 'params') req.validatedParams = parsed.data;
    else req.body = parsed.data;
    next();
  };
}

const loginSchema = z.object({
  user: z.string({ error: 'Usuário é obrigatório' }).trim().min(1, 'Usuário é obrigatório').max(80, 'Usuário muito longo'),
  pass: z.string({ error: 'Senha é obrigatória' }).min(1, 'Senha é obrigatória').max(128, 'Senha muito longa')
}).passthrough();

const passwordChangeSchema = z.object({
  current: z.string({ error: 'Informe a senha atual' }).min(1, 'Informe a senha atual').max(128),
  next: z.string({ error: 'Informe a nova senha' }).min(8, 'Nova senha deve ter ao menos 8 caracteres').max(128, 'Nova senha muito longa')
    .regex(/[A-Za-z]/, 'Nova senha deve conter letras').regex(/\d/, 'Nova senha deve conter números')
}).passthrough();

const userCreateSchema = z.object({
  user: z.string({ error: 'Usuário é obrigatório' }).trim().min(1, 'Usuário é obrigatório').max(80),
  name: z.string({ error: 'Nome é obrigatório' }).trim().min(2, 'Nome muito curto').max(160),
  role: z.enum(['recepcao', 'tecnico', 'psico', 'admin'], { error: 'Perfil inválido' }),
  pass: z.string({ error: 'Senha é obrigatória' }).min(8, 'Senha deve ter ao menos 8 caracteres').max(128)
}).passthrough();

const personBase = {
  nome: z.string({ error: 'Nome é obrigatório' }).trim().min(2, 'Nome muito curto').max(160, 'Nome muito longo'),
  cpf: optionalText(20, 'CPF'),
  rg: optionalText(30, 'RG'),
  nomeMae: optionalText(160, 'Nome da mãe'),
  dataNascimento: optionalText(20, 'Data de nascimento'),
  modeloTornozeleira: optionalText(40, 'Modelo da tornozeleira'),
  cpfN: optionalText(20, 'CPF')
};
const personCreateSchema = z.object(personBase).passthrough();
const personPatchSchema = z.object(personBase).partial().passthrough();

const ticketCreateSchema = z.object({
  personId: z.union([z.string(), z.number()], { error: 'Atendido inválido' }),
  motivo: optionalText(120, 'Motivo'),
  descricao: optionalText(5000, 'Descrição'),
  prioridadeLegal: z.union([z.string(), z.boolean()]).optional(),
  tecnicoRecepcao: optionalText(120, 'Técnico'),
  modeloTornozeleira: optionalText(40, 'Modelo'),
  setor: optionalText(40, 'Setor'),
  visitante: z.union([z.string(), z.boolean()]).optional()
}).passthrough();

module.exports = {
  z, validate,
  loginSchema, passwordChangeSchema, userCreateSchema,
  personCreateSchema, personPatchSchema, ticketCreateSchema
};
