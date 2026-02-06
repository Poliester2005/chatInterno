# Deploy no Render

## Configuração Automática (Recomendado)

1. Faça commit e push do código para o GitHub:
   ```bash
   git add .
   git commit -m "Configuração para Render"
   git push
   ```

2. Acesse [render.com](https://render.com) e crie uma conta

3. Clique em "New +" → "Web Service"

4. Conecte seu repositório GitHub

5. O Render detectará automaticamente o `render.yaml` e configurará tudo

6. Clique em "Create Web Service"

## Configuração Manual

Se preferir configurar manualmente:

1. No Render, clique em "New +" → "Web Service"

2. Conecte seu repositório

3. Configure:
   - **Name**: expresspython-chat (ou nome de sua preferência)
   - **Runtime**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT main:app`

4. Variáveis de Ambiente (Environment):
   - `FLASK_ENV`: `production`
   - `SECRET_KEY`: (clique em "Generate" para criar uma chave aleatória)

5. Clique em "Create Web Service"

## Observações Importantes

- ⚠️ **Banco de Dados SQLite**: O Render usa disco efêmero, então o SQLite funcionará mas os dados serão perdidos ao reiniciar. Para persistência:
  - Opção 1: Use Render Disks (adicione um disco persistente de 1GB grátis)
  - Opção 2: Migre para PostgreSQL (recomendado para produção)

- ✅ **WebSockets**: Funcionam perfeitamente com eventlet no Render

- 🔄 **Auto-deploy**: O Render faz deploy automático a cada push no branch principal

## URL da Aplicação

Após o deploy, sua aplicação estará disponível em:
`https://seu-app.onrender.com`
