const TICKET_STATUS = {
  AGUARDANDO: 'aguardando',
  EM_ATENDIMENTO: 'em_atendimento',
  FINALIZADO: 'finalizado',
  CANCELADO: 'cancelado',
};

const TICKET_MODEL = {
  SPACECOM: 'Spacecom',
  INFINITY: 'Infinity',
};

const MOTIVOS_OK = ['Botão do Pânico', 'Instalação de Tornozeleira', 'Retirada de Tornozeleira', 'Manutenção', 'Outros'];

const ROLES = {
  RECEPCAO: 'recepcao',
  TECNICO: 'tecnico',
  ADMIN: 'admin',
};

const USERS = {
  JULIO: 'julio',
};

const PERSON_LABELS = { nome: 'Nome', cpf: 'CPF', rg: 'RG', nomeMae: 'Nome da mãe', dataNascimento: 'Data de nascimento', modeloTornozeleira: 'Modelo da tornozeleira' };

const MAX_PASSWORD_LEN = 128;
const MIN_PASSWORD_LEN = 4;
const MAX_TEXT_LEN = 1000;
const MAX_RELATORY_LEN = 10;
const MAX_CHARS_NAME = 80;
const MAX_CHARS_DESTINATARIO = 120;
const MAX_CHARS_DESCRICAO = 2000;
const MAX_CHARS_EQUIP = 30;
const MAX_EQUIPMENTOS = 30;
const MAX_EQUIPMENTOS_RECOLHIMENTO = 60;
const MAX_ANEXOS = 20;
const MAX_ANEXOS_CHAT = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_TICKETS_CHAT = 2000;
const MAX_AUDIT = 500;
const SESSION_EXPIRY_MS = 12 * 3600e3;
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW_MS = 5 * 60e3;
const FILES_TTL_HOURS_DEFAULT = 24;
const CALL_TTL_MS = 60e3;
const GOOGLE_STATE_EXPIRY_MS = 10 * 60e3;
const CLEANUP_INTERVAL_MS = 3600e3;
const CLEANUP_DELAY_MS = 60e3;
const SUPABASE_LISTEN_CHANNEL = 'realtime:public';
const SUPABASE_FILTER_ALL = '*';
const SUPABASE_FILTER_TICKETS = 'status=eq.aguardando';
const AGENDA_DAYS = 7;
const PRIORIDADE_ALTA_MS = 30 * 60e3;

const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'webm', 'mp3', 'ogg', 'm4a', 'mp4', 'wav'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv', 'audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/wave', 'audio/x-wav'];

module.exports = { TICKET_STATUS, TICKET_MODEL, MOTIVOS_OK, ROLES, USERS, PERSON_LABELS, MAX_PASSWORD_LEN, MIN_PASSWORD_LEN, MAX_TEXT_LEN, MAX_RELATORY_LEN, MAX_CHARS_NAME, MAX_CHARS_DESTINATARIO, MAX_CHARS_DESCRICAO, MAX_CHARS_EQUIP, MAX_EQUIPMENTOS, MAX_EQUIPMENTOS_RECOLHIMENTO, MAX_ANEXOS, MAX_ANEXOS_CHAT, MAX_FILE_SIZE, MAX_TICKETS_CHAT, MAX_AUDIT, SESSION_EXPIRY_MS, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS, FILES_TTL_HOURS_DEFAULT, CALL_TTL_MS, GOOGLE_STATE_EXPIRY_MS, CLEANUP_INTERVAL_MS, CLEANUP_DELAY_MS, SUPABASE_LISTEN_CHANNEL, SUPABASE_FILTER_ALL, SUPABASE_FILTER_TICKETS, AGENDA_DAYS, PRIORIDADE_ALTA_MS, ALLOWED_EXT, ALLOWED_MIME };
