#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servico de OCR/ICR Local com Visao Computacional Multimodal
============================================================

Implementa:
1. OCR (Reconhecimento Optico de Caracteres) - Texto impresso/digitado
   - PaddleOCR (melhor para impresso + manuscrito)
   - EasyOCR (bom para impresso, razoavel para manuscrito)
   - Tesseract (tradicional, bom para impresso com modelos portugues)

2. ICR (Reconhecimento Inteligente de Caracteres) - Escrita manual/assinaturas
   - PaddleOCR com modelos de mao
   - EasyOCR com suporte a caligrafia

3. Analise de Layout de Documento (Document Layout Analysis):
   - Deteccao de estrutura visual (tabelas, campos, cabecalhos)
   - Associacao de rotulos aos valores (ex: "MONITORADO(A):" -> nome,
     "Data/Hora:" -> data, "Nº:" -> dispositivo)
   - Extracao por regioes fixas (coordenadas de formularios)

4. Pre-processamento com OpenCV:
   - Correcao de inclinacao (deskew)
   - Reducao de ruido
   - Ajuste de contraste
   - Recorte de regioes de interesse

Tudo roda LOCALMENTE no servidor, sem APIs externas.
"""

import os
import sys
import json
import base64
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

# Carregar modelos OCR
try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except ImportError:
    PADDLE_AVAILABLE = False

try:
    import easyocr
    EASYOCR_AVAILABLE = True
except ImportError:
    EASYOCR_AVAILABLE = False

try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False

def temVisaoNuvem():
    """Verifica se a visao computacional esta disponivel"""
    return PADDLE_AVAILABLE or EASYOCR_AVAILABLE or TESSERACT_AVAILABLE

# Configuracoes
MODEL_DIR = Path(__file__).parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# Coordenadas conhecidas dos campos dos formularios (layout fixo)
FORM_FIELDS = {
    "termo_recolhimento": {
        "monitorado": {"x": 0.15, "y": 0.18, "w": 0.55, "h": 0.08},
        "data_hora": {"x": 0.72, "y": 0.18, "w": 0.25, "h": 0.08},
        "dispositivo": {"x": 0.15, "y": 0.30, "w": 0.40, "h": 0.06},
    },
    "termo_ativacao": {
        "nome_monitorado": {"x": 0.15, "y": 0.22, "w": 0.60, "h": 0.08},
        "data": {"x": 0.15, "y": 0.35, "w": 0.30, "h": 0.06},
    },
    "termo_endereco": {
        "nome": {"x": 0.20, "y": 0.40, "w": 0.55, "h": 0.06},
        "cpf": {"x": 0.20, "y": 0.48, "w": 0.30, "h": 0.06},
        "endereco": {"x": 0.20, "y": 0.56, "w": 0.60, "h": 0.08},
    },
    "declaracao": {
        "nome": {"x": 0.20, "y": 0.30, "w": 0.55, "h": 0.06},
        "cpf": {"x": 0.20, "y": 0.38, "w": 0.30, "h": 0.06},
    },
    "default": {}
}

KNOWN_LABELS = [
    "MONITORADO", "MONITORADO(A)", "MONITORADO(A):", "NOME DO MONITORADO",
    "NOME COMPLETO", "NOME", "INTERRESSADO", "INTERRESSADO(A)", "INTERRESSADOS",
    "DATA", "DATA/HORA", "DATA/HORA:", "DATA:", "DATA DE",
    "NUMERO", "NÚMERO", "Nº", "Nº:", "NUMERO DO DISPOSITIVO", "DISPOSITIVO",
    "CPF", "CPF:", "RG", "RG:", "MATRICULA", "MATRICULA",
    "ASSINATURA", "ASSINATURA:", "ASSINADO",
    "NOME DA MAE", "NOME DO PAI", "NOME DA MAE", "NOME DO PAI",
    "ENDERECO", "ENDERECO", "ENDERECO:", "LOGRADOURO",
    "PROCESSO", "PROCESSO:", "VARA", "VARA:",
    "ASSINATURA", "ASSINATURA:", "ASSINADO",
    "NOME DA MAE", "NOME DO PAI", "NOME DA MAE", "NOME DO PAI",
    "ENDERECO", "ENDERECO", "ENDERECO:", "LOGRADOURO",
    "PROCESSO", "PROCESSO:", "VARA", "VARA:",
    "ASSINATURA DO RESPONSAVEL", "ASSINATURA DO TECNICO",
]

@dataclass
class OCRResult:
    text: str
    confidence: float
    bbox: List[List[int]]
    engine: str

@dataclass
class FieldExtraction:
    label: str
    value: str
    confidence: float
    bbox: List[List[int]]
    method: str

@dataclass
class DocumentAnalysis:
    document_type: str
    full_text: str
    fields: List[FieldExtraction]
    fields_dict: Dict[str, str]
    raw_ocr_results: List[OCRResult]
    confidence: float


class ImagePreprocessor:
    @staticmethod
    def load_image(image_data: bytes) -> np.ndarray:
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            pil_img = Image.open(BytesIO(image_data))
            img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
        return img
    
    @staticmethod
    def preprocess_for_ocr(img: np.ndarray, enhance_handwritten: bool = False) -> np.ndarray:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        h, w = gray.shape
        max_dim = 2000
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        
        gray = ImagePreprocessor.deskew(gray)
        
        denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
        
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(denoised)
        
        if enhance_handwritten:
            binary = cv2.adaptiveThreshold(
                enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, 11, 2
            )
            return binary
        
        return enhanced
    
    @staticmethod
    def deskew(image: np.ndarray) -> np.ndarray:
        edges = cv2.Canny(image, 50, 150, apertureSize=3)
        lines = cv2.HoughLines(edges, 1, np.pi/180, threshold=100)
        
        if lines is not None:
            angles = []
            for line in lines[:20]:
                rho, theta = line[0]
                angle = theta * 180 / np.pi - 90
                if -45 < angle < 45:
                    angles.append(angle)
            
            if angles:
                median_angle = np.median(angles)
                if abs(median_angle) > 0.5:
                    h, w = image.shape[:2]
                    center = (w // 2, h // 2)
                    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
                    image = cv2.warpAffine(image, M, (w, h), 
                                          flags=cv2.INTER_CUBIC, 
                                          borderMode=cv2.BORDER_REPLICATE)
        return image
    
    @staticmethod
    def extract_field_region(image: np.ndarray, field_config: Dict, 
                            image_shape: Tuple[int, int]) -> np.ndarray:
        h, w = image_shape[:2]
        x = int(field_config["x"] * w)
        y = int(field_config["y"] * h)
        fw = int(field_config["w"] * w)
        fh = int(field_config["h"] * h)
        
        x = max(0, min(x, w - 1))
        y = max(0, min(y, h - 1))
        fw = min(fw, w - x)
        fh = min(fh, h - y)
        
        return image[y:y+fh, x:x+fw]


class LayoutAnalyzer:
    def __init__(self):
        self.known_labels = KNOWN_LABELS
    
    def find_label_value_pairs(self, ocr_results: List[OCRResult]) -> List[FieldExtraction]:
        fields = []
        sorted_results = sorted(ocr_results, key=lambda r: (r.bbox[0][1], r.bbox[0][0]))
        
        for i, result in enumerate(sorted_results):
            text = result.text.strip()
            text_upper = text.upper()
            
            for label in self.known_labels:
                if self._fuzzy_match(label, text_upper):
                    value = self._find_associated_value(sorted_results, i, result)
                    if value:
                        fields.append(FieldExtraction(
                            label=label,
                            value=value.text,
                            confidence=min(result.confidence, value.confidence),
                            bbox=value.bbox,
                            method='label_association'
                        ))
                    break
        
        return fields
    
    def _fuzzy_match(self, label: str, text: str) -> bool:
        if label in text or text in label:
            return True
        label_clean = label.replace(":", "").replace("(", "").replace(")", "")
        text_clean = text.replace(":", "").replace("(", "").replace(")", "")
        if label_clean == text_clean:
            return True
        if len(label_clean) > 5 and len(text_clean) > 5:
            matches = sum(1 for a, b in zip(label_clean, text_clean) if a == b)
            if matches / max(len(label_clean), len(text_clean)) > 0.7:
                return True
        return False
    
    def _find_associated_value(self, results: List[OCRResult], label_idx: int, 
                               label_result: OCRResult) -> Optional[OCRResult]:
        label_bbox = label_result.bbox
        label_center_y = sum(p[1] for p in label_bbox) / 4
        label_center_x = sum(p[0] for p in label_bbox) / 4
        label_right = max(p[0] for p in label_bbox)
        
        best_candidate = None
        best_score = 0
        
        for i, result in enumerate(results):
            if i == label_idx:
                continue
            
            text = result.text.strip()
            if not text or len(text) < 2:
                continue
            
            bbox = result.bbox
            center_y = sum(p[1] for p in bbox) / 4
            center_x = sum(p[0] for p in bbox) / 4
            
            dx = center_x - label_right
            dy = center_y - label_center_y
            
            score = 0
            if 0 < dx < 300 and abs(dy) < 30:
                score = 100 - dx / 3
            elif 0 < dy < 100 and abs(dx) < 100:
                score = 80 - dy
            elif dx > -100 and dy > -50:
                score = 50 - abs(dx) / 10 - abs(dy) / 5
            
            if score > best_score and score > 10:
                best_score = score
                best_candidate = result
        
        return best_candidate
    
    def extract_by_fixed_layout(self, image: np.ndarray, doc_type: str) -> List[FieldExtraction]:
        fields = []
        layout = FORM_FIELDS.get(doc_type, FORM_FIELDS["default"])
        h, w = image.shape[:2]
        
        for field_name, coords in layout.items():
            x = int(coords["x"] * w)
            y = int(coords["y"] * h)
            fw = int(coords["w"] * w)
            fh = int(coords["h"] * h)
            
            x = max(0, min(x, w - 1))
            y = max(0, min(y, h - 1))
            fw = min(fw, w - x)
            fh = min(fh, h - y)
            
            if fw > 10 and fh > 10:
                fields.append(FieldExtraction(
                    label=field_name,
                    value="",
                    confidence=0.0,
                    bbox=[[x, y], [x+fw, y], [x+fw, y+fh], [x, y+fh]],
                    method='layout'
                ))
        
        return fields


class OCREngine:
    def __init__(self):
        self.paddle_ocr = None
        self.easyocr_reader = None
        self._init_engines()
    
    def _init_engines(self):
        global PADDLE_AVAILABLE, EASYOCR_AVAILABLE, TESSERACT_AVAILABLE
        
        if PADDLE_AVAILABLE:
            try:
                self.paddle_ocr = PaddleOCR(
                    use_textline_orientation=True,
                    lang='pt',
                    enable_mkldnn=True,
                    cpu_threads=4
                )
                print("PaddleOCR inicializado com sucesso")
            except TypeError as e:
                try:
                    self.paddle_ocr = PaddleOCR(
                        use_textline_orientation=True,
                        lang='pt',
                        show_log=False,
                        enable_mkldnn=True,
                        cpu_threads=4
                    )
                    print("PaddleOCR inicializado com sucesso (fallback)")
                except Exception as e2:
                    print("PaddleOCR falhou: " + str(e2))
                    self.paddle_ocr = None
            except Exception as e:
                print("PaddleOCR falhou: " + str(e))
                self.paddle_ocr = None
        
        if EASYOCR_AVAILABLE:
            try:
                self.easyocr_reader = easyocr.Reader(['pt', 'en'], gpu=False)
                print("EasyOCR inicializado com sucesso")
            except Exception as e:
                print("EasyOCR falhou: " + str(e))
                self.easyocr_reader = None
        
        if TESSERACT_AVAILABLE:
            try:
                pytesseract.get_tesseract_version()
                print("Tesseract disponivel")
            except Exception as e:
                print("Tesseract nao encontrado: " + str(e))
                TESSERACT_AVAILABLE = False

    def ocr_paddle(self, image: np.ndarray, enhance_handwritten: bool = False) -> List[OCRResult]:
        if not self.paddle_ocr:
            return []
        
        try:
            if len(image.shape) == 2:
                img_rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
            else:
                img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            result = self.paddle_ocr.ocr(img_rgb, cls=True)
            
            results = []
            if result and result[0]:
                for line in result[0]:
                    bbox = line[0]
                    text = line[1][0]
                    conf = line[1][1]
                    results.append(OCRResult(
                        text=text,
                        confidence=conf,
                        bbox=[[int(p[0]), int(p[1])] for p in bbox],
                        engine='paddleocr'
                    ))
            return results
        except Exception as e:
            print("PaddleOCR erro: " + str(e))
            return []
    
    def ocr_easyocr(self, image: np.ndarray) -> List[OCRResult]:
        if not self.easyocr_reader:
            return []
        
        try:
            if len(image.shape) == 2:
                img_rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
            else:
                img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            results = self.easyocr_reader.readtext(img_rgb)
            
            ocr_results = []
            for bbox, text, conf in results:
                ocr_results.append(OCRResult(
                    text=text,
                    confidence=conf,
                    bbox=[[int(p[0]), int(p[1])] for p in bbox],
                    engine='easyocr'
                ))
            return ocr_results
        except Exception as e:
            print("EasyOCR erro: " + str(e))
            return []
    
    def ocr_tesseract(self, image: np.ndarray, lang: str = 'por') -> List[OCRResult]:
        if not TESSERACT_AVAILABLE:
            return []
        
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            custom_config = r'--oem 3 --psm 6 -c preserve_interword_spaces=1'
            
            data = pytesseract.image_to_data(gray, lang=lang, config=custom_config, output_type=pytesseract.Output.DICT)
            
            results = []
            n_boxes = len(data['text'])
            for i in range(n_boxes):
                text = data['text'][i].strip()
                conf = int(data['conf'][i]) if data['conf'][i] != '-1' else 0
                if text and conf > 30:
                    x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                    results.append(OCRResult(
                        text=text,
                        confidence=conf / 100.0,
                        bbox=[[x, y], [x+w, y], [x+w, y+h], [x, y+h]],
                        engine='tesseract'
                    ))
            return results
        except Exception as e:
            print("Tesseract erro: " + str(e))
            return []
    
    def ocr_all(self, image: np.ndarray, enhance_handwritten: bool = False) -> List[OCRResult]:
        all_results = []
        
        if self.paddle_ocr:
            results = self.ocr_paddle(image, enhance_handwritten)
            all_results.extend(results)
            print("  PaddleOCR: " + str(len(results)) + " resultados")
        
        if self.easyocr_reader:
            results = self.ocr_easyocr(image)
            all_results.extend(results)
            print("  EasyOCR: " + str(len(results)) + " resultados")
        
        if TESSERACT_AVAILABLE:
            results = self.ocr_tesseract(image)
            all_results.extend(results)
            print("  Tesseract: " + str(len(results)) + " resultados")
        
        return all_results


class DocumentProcessor:
    def __init__(self):
        self.preprocessor = ImagePreprocessor()
        self.layout_analyzer = LayoutAnalyzer()
        self.ocr_engine = OCREngine()
    
    def detect_document_type(self, text: str) -> str:
        text_lower = text.lower()
        
        if any(k in text_lower for k in ['termo de recolhimento', 'monitorado(a)', 'unidades penais']):
            if 'monitorado(a)' in text_lower or 'monitorado(a):' in text_lower:
                return 'termo_recolhimento_equipamento'
            return 'termo_recolhimento'
        elif any(k in text_lower for k in ['termo de ativacao', 'ativacao de tornozeleira']):
            return 'termo_ativacao'
        elif any(k in text_lower for k in ['oficio', 'endereco do monitorado', 'interessado']):
            return 'termo_endereco'
        elif 'declaracao' in text_lower:
            return 'declaracao'
        elif 'relatorio' in text_lower:
            return 'relatorio'
        elif 'ata' in text_lower:
            return 'ata'
        return 'default'
    
    def process_document(self, image_data: bytes, doc_type_hint: str = None) -> DocumentAnalysis:
        print("\n" + "=" * 60)
        print("PROCESSANDO DOCUMENTO")
        print("=" * 60)
        
        img = self.preprocessor.load_image(image_data)
        print("  Imagem carregada: " + str(img.shape[1]) + "x" + str(img.shape[0]))
        
        processed = self.preprocessor.preprocess_for_ocr(img, enhance_handwritten=True)
        print("  Pre-processamento concluido")
        
        quick_text = ""
        if TESSERACT_AVAILABLE:
            try:
                quick_text = pytesseract.image_to_string(
                    cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY) if len(processed.shape)==3 else processed,
                    lang='por'
                )
            except:
                pass
        
        doc_type = doc_type_hint or self.detect_document_type(quick_text)
        print("  Tipo detectado: " + doc_type)
        
        print("  Executando OCR multi-engine...")
        all_ocr_results = self.ocr_engine.ocr_all(processed, enhance_handwritten=True)
        
        unique_results = self._deduplicate_ocr(all_ocr_results)
        print("  Resultados unicos: " + str(len(unique_results)))
        
        full_text = "\n".join([r.text for r in unique_results])
        
        fields = self.layout_analyzer.find_label_value_pairs(unique_results)
        
        doc_type_key = self._get_doc_type_key(doc_type)
        layout_fields = self.layout_analyzer.extract_by_fixed_layout(
            self.preprocessor.preprocess_for_ocr(img), doc_type_key
        )
        
        for lf in layout_fields:
            roi = self.preprocessor.extract_field_region(
                processed, 
                {k: v for k, v in FORM_FIELDS.get(doc_type_key, {}).get(lf.label, {}).items()},
                processed.shape
            )
            if roi.size > 0:
                roi_text = self._ocr_roi(roi)
                if roi_text:
                    lf.value = roi_text
                    lf.confidence = 0.8
        
        all_fields = fields + layout_fields
        
        fields_dict = {}
        for f in all_fields:
            if f.value:
                fields_dict[f.label] = f.value
        
        confidences = [f.confidence for f in all_fields if f.confidence > 0]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        return DocumentAnalysis(
            document_type=doc_type,
            full_text=full_text,
            fields=all_fields,
            fields_dict=fields_dict,
            raw_ocr_results=unique_results,
            confidence=avg_confidence
        )
    
    def _get_doc_type_key(self, doc_type: str) -> str:
        mapping = {
            'termo_recolhimento': 'termo_recolhimento',
            'termo_recolhimento_equipamento': 'termo_recolhimento',
            'termo_ativacao': 'termo_ativacao',
            'termo_endereco': 'termo_endereco',
            'declaracao': 'declaracao',
        }
        return mapping.get(doc_type, 'default')
    
    def _deduplicate_ocr(self, results: List[OCRResult]) -> List[OCRResult]:
        if not results:
            return []
        
        sorted_results = sorted(results, key=lambda r: r.confidence, reverse=True)
        
        unique = []
        for r in sorted_results:
            is_dup = False
            for u in unique:
                if (self._text_similar(r.text, u.text) > 0.8 and 
                    self._bbox_overlap(r.bbox, u.bbox) > 0.5):
                    is_dup = True
                    break
            if not is_dup:
                unique.append(r)
        return unique
    
    def _text_similar(self, a: str, b: str) -> float:
        a, b = a.lower().strip(), b.lower().strip()
        if a == b:
            return 1.0
        if a in b or b in a:
            return 0.8
        set_a, set_b = set(a.split()), set(b.split())
        if not set_a or not set_b:
            return 0
        return len(set_a & set_b) / len(set_a | set_b)
    
    def _bbox_overlap(self, bbox1: List, bbox2: List) -> float:
        def bbox_to_rect(bbox):
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            return min(xs), min(ys), max(xs), max(ys)
        
        x1, y1, x2, y2 = bbox_to_rect(bbox1)
        x3, y3, x4, y4 = bbox_to_rect(bbox2)
        
        xi1, yi1 = max(x1, x3), max(y1, y3)
        xi2, yi2 = min(x2, x4), min(y2, y4)
        
        if xi2 <= xi1 or yi2 <= yi1:
            return 0.0
        
        inter = (xi2 - xi1) * (yi2 - yi1)
        area1 = (x2 - x1) * (y2 - y1)
        area2 = (x4 - x3) * (y4 - y3)
        union = area1 + area2 - inter
        
        return inter / union if union > 0 else 0
    
    def _ocr_roi(self, roi: np.ndarray) -> str:
        if roi.size == 0:
            return ""
        try:
            if TESSERACT_AVAILABLE:
                if len(roi.shape) == 3:
                    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                else:
                    gray = roi
                text = pytesseract.image_to_string(gray, lang='por', config='--psm 7')
                return text.strip()
        except:
            pass
        return ""


from flask import Flask, request, jsonify

app = Flask(__name__)
processor = DocumentProcessor()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'engines': {
            'paddleocr': PADDLE_AVAILABLE and processor.ocr_engine.paddle_ocr is not None,
            'easyocr': EASYOCR_AVAILABLE and processor.ocr_engine.easyocr_reader is not None,
            'tesseract': TESSERACT_AVAILABLE
        }
    })

@app.route('/ocr/analyze', methods=['POST'])
def analyze_document():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'Nenhum arquivo enviado'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Arquivo vazio'}), 400
        
        file_bytes = file.read()
        doc_type_hint = request.form.get('doc_type')
        
        result = processor.process_document(file_bytes, doc_type_hint)
        
        response = {
            'document_type': result.document_type,
            'full_text': result.full_text,
            'confidence': result.confidence,
            'fields': [asdict(f) for f in result.fields],
            'fields_dict': result.fields_dict,
            'raw_ocr_count': len(result.raw_ocr_results)
        }
        
        return jsonify(response)
    
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/ocr/extract-fields', methods=['POST'])
def extract_fields():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'Nenhum arquivo enviado'}), 400
        
        file = request.files['file']
        doc_type = request.form.get('doc_type', 'default')
        
        file_bytes = file.read()
        img = processor.preprocessor.load_image(file_bytes)
        processed = processor.preprocessor.preprocess_for_ocr(img)
        
        doc_type_key = processor._get_doc_type_key(doc_type)
        layout_fields = processor.layout_analyzer.extract_by_fixed_layout(
            processed, doc_type_key
        )
        
        results = {}
        for lf in layout_fields:
            roi = processor.preprocessor.extract_field_region(
                processed,
                {k: v for k, v in FORM_FIELDS.get(doc_type, {}).get(lf.label, {}).items()},
                processed.shape
            )
            if roi.size > 0:
                text = processor._ocr_roi(roi)
                if text:
                    results[lf.label] = text
        
        return jsonify({
            'doc_type': doc_type,
            'fields': results
        })
    
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("SERVICO DE OCR/ICR LOCAL - VISAO COMPUTACIONAL MULTIMODAL")
    print("=" * 60)
    print("PaddleOCR: " + ("OK" if PADDLE_AVAILABLE else "FALHA"))
    print("EasyOCR: " + ("OK" if EASYOCR_AVAILABLE else "FALHA"))
    print("Tesseract: " + ("OK" if TESSERACT_AVAILABLE else "FALHA"))
    print("OpenCV: OK")
    print("=" * 60)
    
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)