import requests

# Check production version
resp = requests.get('https://sisumepe.onrender.com/', timeout=30)
content = resp.text

print('Production HTML size:', len(content))

# Check for the forms
for form_id in ['termoFormPdf', 'termoFormRenomear', 'termoFormOutros', 'termoFormListagem']:
    idx = content.find(form_id)
    if idx >= 0:
        # Get more context
        start = max(0, idx - 200)
        snippet = content[start:idx+300]
        # Check if it has the hidden class
        if 'hidden' in content[idx:idx+100]:
            print('{}: FOUND (HIDDEN)'.format(form_id))
        else:
            print('{}: FOUND (VISIBLE)'.format(form_id))
    else:
        print('{}: NOT FOUND'.format(form_id))

# Check for setTermoTipo function
idx = content.find('function setTermoTipo')
if idx >= 0:
    # Get the function body (first 2000 chars)
    func = content[idx:idx+2000]
    # Check if it handles pdf and renomear
    if "'pdf'" in func or '"pdf"' in func:
        print('setTermoTipo handles pdf: YES')
    else:
        print('setTermoTipo handles pdf: NO')
    if "'renomear'" in func or '"renomear"' in func:
        print('setTermoTipo handles renomear: YES')
    else:
        print('setTermoTipo handles renomear: NO')
    if 'termoFormPdf' in func:
        print('setTermoTipo toggles termoFormPdf: YES')
    else:
        print('setTermoTipo toggles termoFormPdf: NO')
    if 'termoFormRenomear' in func:
        print('setTermoTipo toggles termoFormRenomear: YES')
    else:
        print('setTermoTipo toggles termoFormRenomear: NO')
else:
    print('setTermoTipo: NOT FOUND')

# Check for tab buttons
for tab_id in ['termoTipoPdf', 'termoTipoRenomear']:
    idx = content.find(tab_id)
    if idx >= 0:
        print('{}: BUTTON FOUND'.format(tab_id))
    else:
        print('{}: BUTTON NOT FOUND'.format(tab_id))
