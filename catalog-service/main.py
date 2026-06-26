import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Numeric, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

DATABASE_URL  = os.getenv("DATABASE_URL", "postgresql://user:pass@postgres:5432/catalogdb")
JWT_SECRET    = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALGORITHM = "HS256"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

app = FastAPI(title="Loruceanro — Catalog Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Models ────────────────────────────────────────────────────────────────────

class Category(Base):
    __tablename__ = "categories"
    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(100), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    products   = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = "products"
    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, default="")
    price       = Column(Numeric(10, 2), nullable=False)
    stock       = Column(Integer, default=0)
    image_url   = Column(String(500), default="")
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    category    = relationship("Category", back_populates="products")


Base.metadata.create_all(bind=engine)


# ── Seed ──────────────────────────────────────────────────────────────────────

@app.on_event("startup")
def seed():
    db = SessionLocal()
    try:
        if db.query(Category).count() > 0:
            return

        cats = {}
        for name in ["Електроніка", "Одяг", "Взуття", "Аксесуари"]:
            c = Category(name=name)
            db.add(c)
            db.flush()
            cats[name] = c.id

        products = [
            ("iPhone 15 Pro 256GB", "Смартфон Apple з чипом A17 Pro, титановий корпус", 35990, 12, "https://images.unsplash.com/photo-1696446701796-da61c5c5f15c?w=400", "Електроніка"),
            ('MacBook Air M3 13"', "Ноутбук Apple, 8GB RAM, 256GB SSD, колір Midnight", 54990, 5, "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400", "Електроніка"),
            ("Sony WH-1000XM5", "Бездротові навушники з шумопоглинанням, 30 год роботи", 12990, 20, "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=400", "Електроніка"),
            ('Samsung 4K QLED 55"', "Телевізор 55 дюймів, 120Hz, Smart TV", 22990, 8, "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=400", "Електроніка"),
            ("Nike Air Max 270", "Кросівки для бігу з Air-підошвою, розміри 40-46", 3490, 35, "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400", "Взуття"),
            ("Adidas Ultraboost 23", "Професійні бігові кросівки, технологія Boost", 4290, 25, "https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=400", "Взуття"),
            ("New Balance 574", "Класичні кросівки, замша + сітка", 2790, 40, "https://images.unsplash.com/photo-1539185441755-769473a23570?w=400", "Взуття"),
            ("Шкіряна куртка чоловіча", "Натуральна шкіра, коса блискавка, розміри S-XXL", 4990, 15, "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400", "Одяг"),
            ("Джинси Levi's 501", "Класичні прямі джинси, 100% бавовна", 1990, 50, "https://images.unsplash.com/photo-1542272604-787c3835535d?w=400", "Одяг"),
            ("Худі оверсайз", "Бавовна 85%, поліестер 15%, унісекс", 1190, 60, "https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=400", "Одяг"),
            ("Casio G-Shock GA-2100", "Ударостійкий, водонепроникний 200м, сонячна батарея", 2790, 18, "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400", "Аксесуари"),
            ('Рюкзак The North Face 30L', 'Водовідштовхувальний, відсік для ноутбука 15"', 3190, 22, "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400", "Аксесуари"),
        ]

        for name, desc, price, stock, img, cat_name in products:
            db.add(Product(
                name=name,
                description=desc,
                price=price,
                stock=stock,
                image_url=img,
                category_id=cats[cat_name],
            ))

        db.commit()
    finally:
        db.close()


# ── Schemas ───────────────────────────────────────────────────────────────────

class CategoryOut(BaseModel):
    id: int
    name: str
    model_config = {"from_attributes": True}


class ProductOut(BaseModel):
    id: int
    name: str
    description: str
    price: float
    stock: int
    image_url: str
    category_id: Optional[int]
    category: Optional[CategoryOut]
    created_at: datetime
    model_config = {"from_attributes": True}


class CategoryIn(BaseModel):
    name: str


class ProductIn(BaseModel):
    name: str
    description: str = ""
    price: float
    stock: int = 0
    image_url: str = ""
    category_id: Optional[int] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_admin(authorization: str = "") -> bool:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if not payload.get("is_admin"):
            raise HTTPException(403, "Admin only")
    except JWTError:
        raise HTTPException(401, "Invalid token")
    return True


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/catalog/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).all()


@app.post("/api/catalog/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db)):
    if db.query(Category).filter(Category.name == body.name).first():
        raise HTTPException(400, "Category already exists")
    cat = Category(name=body.name)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@app.delete("/api/catalog/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    db.delete(cat)
    db.commit()


@app.get("/api/catalog/products", response_model=list[ProductOut])
def list_products(
    category_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    q = db.query(Product)
    if category_id:
        q = q.filter(Product.category_id == category_id)
    if search:
        q = q.filter(Product.name.ilike(f"%{search}%"))
    return q.offset(offset).limit(limit).all()


@app.get("/api/catalog/products/{product_id}", response_model=ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    return p


@app.post("/api/catalog/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductIn, db: Session = Depends(get_db)):
    p = Product(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@app.put("/api/catalog/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, body: ProductIn, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@app.delete("/api/catalog/products/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    db.delete(p)
    db.commit()
