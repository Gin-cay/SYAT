FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

# 云托管会注入 PORT；本地未注入时默认 8000
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "gunicorn -w 2 -b 0.0.0.0:${PORT:-8000} app:app"]

