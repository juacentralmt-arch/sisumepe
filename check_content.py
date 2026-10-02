import requests

resp = requests.get('https://sisumepe.onrender.com/', timeout=30)
content = resp.text

for form_id in ['termoFormPdf', 'termoFormRenomear']:
    idx = content.find('id="' + form_id + '"')
    if idx >= 0:
        # Get 3000 chars after the opening tag
        snippet = content[idx:idx+3000]
        # Count how much actual content (excluding whitespace)
        print('=== {} ==='.format(form_id))
        print('Length of snippet:', len(snippet))
        # Find the closing of the opening div tag
        tag_end = snippet.find('>')
        print('Opening tag:', snippet[:tag_end+1][:200])
        # Get inner content (first 1500 chars after opening tag)
        inner = snippet[tag_end+1:tag_end+1501]
        print('Inner content preview:')
        print(inner[:1500].encode('ascii', 'replace').decode('ascii'))
        print()
    else:
        print('{}: NOT FOUND'.format(form_id))
