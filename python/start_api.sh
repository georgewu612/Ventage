#!/bin/bash
cd /Users/georgewu/Documents/Ventage/python
exec python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000
