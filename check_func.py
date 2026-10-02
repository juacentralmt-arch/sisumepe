import requests

resp = requests.get('https://sisumepe.onrender.com/', timeout=30)
content = resp.text

idx = content.find('function setTermoTipo')
if idx >= 0:
    # Get more context - the full function
    func = content[idx:idx+3000]
    print(func)
