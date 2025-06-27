from fastapi import FastAPI
from pydantic import BaseModel
import aiosqlite
from datetime import datetime as dt

DB = "tracker.db"
app = FastAPI()

class WindowPing(BaseModel):
    ts: dt
    app_name: str
    title: str

@app.on_event("startup")
async def init():
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS pings(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT, app TEXT, title TEXT
            )
        """); await db.commit()

@app.post("/pings")
async def ingest(p: WindowPing):
    async with aiosqlite.connect(DB) as db:
        temp_time = dt.now()
        await db.execute(
          "INSERT INTO pings (ts, app, title) VALUES (?,?,?)",
          (temp_time.isoformat(), p.app_name, p.title)
        ); await db.commit()
    return {"ok": True}

@app.get("/pings")
async def list(limit: int = 50):
    async with aiosqlite.connect(DB) as db:
        cur = await db.execute(
            "SELECT * FROM pings ORDER BY ts DESC LIMIT ?", (limit,))
        
        return [r for r in await cur.fetchall()]
