"""Password hashing helpers for the single-user login."""

import hashlib
import secrets


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 1 << 14, 8, 1
    key = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${key.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n_text, r_text, p_text, salt_hex, key_hex = encoded.split('$')
        if algorithm != 'scrypt':
            return False
        expected = bytes.fromhex(key_hex)
        actual = hashlib.scrypt(
            password.encode('utf-8'),
            salt=bytes.fromhex(salt_hex),
            n=int(n_text),
            r=int(r_text),
            p=int(p_text),
            dklen=len(expected),
        )
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False
