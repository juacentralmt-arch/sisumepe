/**
 * Serviço de integração com OCR/ICR Local (Python)
 * 
 * Comunica com o serviço Python (src/services/ocr_service.py) via HTTP
 * para realizar OCR/ICR e análise de layout de documentos.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const PYTHON_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:5001';
const PYTHON_SCRIPT = path.join(__dirname, '..', '..', 'src', 'services', 'ocr_service.py');

let pythonProcess = null;
let serviceReady = false;

/**
 * Inicia o serviço Python OCR
 */
async function startOcrService() {
  return new Promise((resolve, reject) => {
    console.log('[OCR] Iniciando serviço Python OCR/ICR...');
    
    pythonProcess = spawn('python', [PYTHON_SCRIPT], {
      cwd: path.dirname(PYTHON_SCRIPT),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[OCR Python]', output.trim());
      if (output.includes('Running on') || output.includes('Servidor Flask')) {
        serviceReady = true;
        resolve();
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error('[OCR Python ERR]', data.toString().trim());
    });

    pythonProcess.on('error', (err) => {
      console.error('[OCR] Erro ao iniciar processo Python:', err);
      reject(err);
    });

    pythonProcess.on('exit', (code) => {
      console.log(`[OCR] Processo Python finalizado com código ${code}`);
      serviceReady = false;
    });

    // Timeout de 60 segundos para inicialização
    setTimeout(() => {
      if (!serviceReady) {
        reject(new Error('Timeout ao iniciar serviço OCR Python'));
      }
    }, 60000);
  });
}

/**
 * Para o serviço Python OCR
 */
function stopOcrService() {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    serviceReady = false;
  }
}

/**
 * Verifica se o serviço está rodando
 */
async function checkServiceHealth() {
  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/health`, { timeout: 5000 });
    const data = await response.json();
    return data.status === 'ok';
  } catch (e) {
    return false;
  }
}

/**
 * Analisa documento usando OCR/ICR multimodal
 * 
 * @param {Buffer} fileBuffer - Buffer do arquivo (PDF ou imagem)
 * @param {string} filename - Nome original do arquivo
 * @param {string} docTypeHint - Dica do tipo de documento (opcional)
 * @returns {Promise<Object>} Resultado da análise
 */
async function analyzeDocument(fileBuffer, filename, docTypeHint = null) {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });
  if (docTypeHint) {
    form.append('doc_type', docTypeHint);
  }

  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/ocr/analyze`, {
      method: 'POST',
      body: form,
      timeout: 300000 // 5 minutos timeout
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Serviço OCR não disponível. Verifique se o serviço Python está rodando.');
    }
    throw error;
  }
}

/**
 * Extrai campos específicos usando layout fixo
 * Mais rápido que análise completa
 */
async function extractFields(fileBuffer, filename, docType = 'default') {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });
  form.append('doc_type', docType);

  try {
    const response = await fetch(`${PYTHON_SERVICE_URL}/ocr/extract-fields`, {
      method: 'POST',
      body: form,
      timeout: 120000
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Serviço OCR não disponível.');
    }
    throw error;
  }
}

/**
 * Converte PDF para imagens (usando pdfjs-dist) e processa cada página
 */
async function processPdfWithVision(pdfBuffer, filename, docTypeHint = null) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  
  const loadingTask = pdfjs.getDocument({ 
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false
  });
  
  const pdf = await loadingTask.promise;
  const maxPages = Math.min(pdf.numPages, 5); // Máximo 5 páginas
  
  const allResults = [];
  
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x para melhor OCR
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({ 
      canvasContext: canvas.getContext('2d'), 
      viewport 
    }).promise;
    
    // Converter canvas para buffer
    const imageBuffer = canvas.toBuffer('image/png');
    
    // Processar página com visão computacional
    const result = await analyzeDocument(imageBuffer, `${filename}_page${i}.png`);
    allResults.push({
      page: i,
      ...result
    });
  }
  
  // Combinar resultados
  return combinePageResults(allResults);
}

/**
 * Combina resultados de múltiplas páginas
 */
function combinePageResults(pageResults) {
  if (!pageResults.length) return null;
  
  // Usar primeira página como base
  const first = pageResults[0];
  
  // Combinar campos (últimas páginas podem ter assinaturas)
  const combinedFields = {};
  const allFields = [];
  
  for (const page of pageResults) {
    for (const [key, value] of Object.entries(page.fields_dict || {})) {
      if (value && !combinedFields[key]) {
        combinedFields[key] = value;
      }
    }
    allFields.push(...(page.fields || []));
  }
  
  // Texto completo
  const fullText = pageResults.map(p => p.full_text).join('\n\n--- PAGE BREAK ---\n\n');
  
  // Confiança média
  const confidences = pageResults.map(p => p.confidence).filter(c => c > 0);
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  
  return {
    document_type: first.document_type,
    full_text: fullText,
    confidence: avgConfidence,
    fields: allFields,
    fields_dict: combinedFields,
    raw_ocr_count: pageResults.reduce((sum, p) => sum + p.raw_ocr_count, 0)
  };
}

/**
 * Auto-inicialização do serviço
 */
let serviceStarted = false;

async function ensureOcrService() {
  if (serviceReady) return true;
  
  // Verificar se já está rodando
  const healthy = await checkServiceHealth();
  if (healthy) {
    serviceReady = true;
    return true;
  }
  
  // Tentar iniciar
  try {
    await startOcrService();
    // Aguardar ficar pronto
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await checkServiceHealth()) {
        serviceReady = true;
        return true;
      }
    }
    throw new Error('Serviço não ficou pronto a tempo');
  } catch (e) {
    console.error('[OCR] Falha ao iniciar serviço:', e.message);
    return false;
  }
}

// Cleanup ao encerrar
process.on('exit', stopOcrService);
process.on('SIGINT', () => { stopOcrService(); process.exit(0); });
process.on('SIGTERM', () => { stopOcrService(); process.exit(0); });

module.exports = {
  analyzeDocument,
  extractFields,
  processPdfWithVision,
  ensureOcrService,
  startOcrService,
  stopOcrService,
  checkServiceHealth,
  PYTHON_SERVICE_URL
};