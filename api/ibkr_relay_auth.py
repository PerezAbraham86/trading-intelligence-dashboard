"""Canonical HMAC envelope shared by the connector and HTTPS receiver."""
import hashlib
import hmac

PATH = "/api/ibkr/tws/relay"


def sign(body: bytes, stamp: str, nonce: str, key: str):
    message = f"{stamp}\n{nonce}\nPOST\n{PATH}\n".encode() + body
    return hmac.new(key.encode(), message, hashlib.sha256).hexdigest()
