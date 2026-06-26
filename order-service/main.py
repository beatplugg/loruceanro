import os
from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Numeric, DateTime, ForeignKey, Enum
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

DATABASE_URL       = os.getenv("DATABASE_URL", "postgresql://user:pass@postgres:5432/ordersdb")
JWT_SECRET         = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALGORITHM      = "HS256"
CATALOG_SERVICE    = os.getenv("CATALOG_SERVICE_URL", "http://catalog-service:8000")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

app = FastAPI(title="Loruceanro — Order Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Models ────────────────────────────────────────────────────────────────────

class OrderStatus(str, PyEnum):
    pending   = "pending"
    confirmed = "confirmed"
    shipped   = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


class Order(Base):
    __tablename__ = "orders"
    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, nullable=False, index=True)
    status     = Column(Enum(OrderStatus), default=OrderStatus.pending)
    total      = Column(Numeric(12, 2), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    items      = relationship("OrderItem", back_populates="order")


class OrderItem(Base):
    __tablename__ = "order_items"
    id         = Column(Integer, primary_key=True, index=True)
    order_id   = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, nullable=False)
    quantity   = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    order      = relationship("Order", back_populates="items")


Base.metadata.create_all(bind=engine)


# ── Schemas ───────────────────────────────────────────────────────────────────

class OrderItemIn(BaseModel):
    product_id: int
    quantity: int


class OrderIn(BaseModel):
    items: list[OrderItemIn]


class OrderItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: int
    user_id: int
    status: OrderStatus
    total: float
    created_at: datetime
    items: list[OrderItemOut]
    model_config = {"from_attributes": True}


class StatusUpdate(BaseModel):
    status: OrderStatus


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def auth_user_id(authorization: str = Header(...)) -> int:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(401, "Invalid token")


def fetch_product(product_id: int) -> dict:
    try:
        r = httpx.get(f"{CATALOG_SERVICE}/api/catalog/products/{product_id}", timeout=5)
        if r.status_code == 404:
            raise HTTPException(400, f"Product {product_id} not found")
        r.raise_for_status()
        return r.json()
    except httpx.RequestError:
        raise HTTPException(503, "Catalog service unavailable")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/orders", response_model=OrderOut, status_code=201)
def create_order(body: OrderIn, user_id: int = Depends(auth_user_id), db: Session = Depends(get_db)):
    if not body.items:
        raise HTTPException(400, "Order must have at least one item")

    resolved = []
    for item in body.items:
        if item.quantity < 1:
            raise HTTPException(400, f"Invalid quantity for product {item.product_id}")
        product = fetch_product(item.product_id)
        if product["stock"] < item.quantity:
            raise HTTPException(400, f"Insufficient stock for '{product['name']}'")
        resolved.append((item, float(product["price"])))

    total = sum(price * item.quantity for item, price in resolved)

    order = Order(user_id=user_id, total=total)
    db.add(order)
    db.flush()

    for item, price in resolved:
        db.add(OrderItem(
            order_id=order.id,
            product_id=item.product_id,
            quantity=item.quantity,
            unit_price=price,
        ))

    db.commit()
    db.refresh(order)
    return order


@app.get("/api/orders", response_model=list[OrderOut])
def list_orders(user_id: int = Depends(auth_user_id), db: Session = Depends(get_db)):
    return db.query(Order).filter(Order.user_id == user_id).order_by(Order.created_at.desc()).all()


@app.get("/api/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: int, user_id: int = Depends(auth_user_id), db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    return order


@app.patch("/api/orders/{order_id}/status", response_model=OrderOut)
def update_status(order_id: int, body: StatusUpdate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    order.status = body.status
    db.commit()
    db.refresh(order)
    return order
