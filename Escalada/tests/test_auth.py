"""
Test suite for auth.py JWT authentication
Run: poetry run pytest tests/test_auth.py -v
"""
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
import jwt
from fastapi import HTTPException


class JWTTokenCreationTest(unittest.TestCase):
    """Test JWT token creation"""

    def test_create_access_token_basic(self):
        """Test basic JWT token creation"""
        from escalada.auth import create_access_token
        
        data = {"sub": "testuser"}
        token = create_access_token(data)
        
        self.assertIsNotNone(token)
        self.assertIsInstance(token, str)
        self.assertGreater(len(token), 50)

    def test_create_access_token_with_custom_expiry(self):
        """Test token creation with custom expiration"""
        from escalada.auth import create_access_token
        
        data = {"sub": "testuser"}
        expires_delta = timedelta(minutes=30)
        token = create_access_token(data, expires_delta=expires_delta)
        
        self.assertIsNotNone(token)
        # Decode without verification to check expiry
        decoded = jwt.decode(token, options={"verify_signature": False})
        self.assertIn("exp", decoded)
        self.assertIn("sub", decoded)
        self.assertEqual(decoded["sub"], "testuser")

    def test_create_access_token_preserves_data(self):
        """Test that token preserves all provided data"""
        from escalada.auth import create_access_token
        
        data = {"sub": "admin", "role": "superuser", "box_id": 1}
        token = create_access_token(data)
        
        decoded = jwt.decode(token, options={"verify_signature": False})
        self.assertEqual(decoded["sub"], "admin")
        self.assertEqual(decoded["role"], "superuser")
        self.assertEqual(decoded["box_id"], 1)

    def test_create_access_token_default_expiry(self):
        """Test token has default expiration"""
        from escalada.auth import create_access_token
        
        data = {"sub": "testuser"}
        token = create_access_token(data)
        
        decoded = jwt.decode(token, options={"verify_signature": False})
        exp_timestamp = decoded["exp"]
        now_timestamp = datetime.utcnow().timestamp()
        
        # Should expire in the future (at least 5 minutes, at most 3 hours)
        time_diff = exp_timestamp - now_timestamp
        self.assertGreater(time_diff, 5 * 60)      # At least 5 minutes
        self.assertLess(time_diff, 180 * 60)        # At most 3 hours


class JWTTokenVerificationTest(unittest.TestCase):
    """Test JWT token verification"""

    def test_verify_token_valid(self):
        """Test verification of valid token"""
        from escalada.auth import create_access_token, verify_token
        from fastapi.security import HTTPAuthorizationCredentials
        
        data = {"sub": "testuser"}
        token = create_access_token(data)
        
        # Create mock credentials
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        
        # Should not raise exception
        result = verify_token(credentials)
        self.assertEqual(result["sub"], "testuser")
        self.assertIn("exp", result)  # Should have expiration

    def test_verify_token_expired(self):
        """Test verification of expired token"""
        from escalada.auth import create_access_token, verify_token
        from fastapi.security import HTTPAuthorizationCredentials
        
        data = {"sub": "testuser"}
        # Create token that expires immediately
        expires_delta = timedelta(seconds=-1)
        token = create_access_token(data, expires_delta=expires_delta)
        
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        
        with self.assertRaises(HTTPException) as context:
            verify_token(credentials)
        self.assertEqual(context.exception.status_code, 401)
        self.assertIn("expired", context.exception.detail.lower())

    def test_verify_token_invalid_signature(self):
        """Test verification of token with invalid signature"""
        from escalada.auth import verify_token
        from fastapi.security import HTTPAuthorizationCredentials
        
        # Create token with wrong signature
        invalid_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.invalid_signature"
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=invalid_token)
        
        with self.assertRaises(HTTPException) as context:
            verify_token(credentials)
        self.assertEqual(context.exception.status_code, 401)

    def test_verify_token_malformed(self):
        """Test verification of malformed token"""
        from escalada.auth import verify_token
        from fastapi.security import HTTPAuthorizationCredentials
        
        malformed_token = "not.a.valid.jwt.token"
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=malformed_token)
        
        with self.assertRaises(HTTPException) as context:
            verify_token(credentials)
        self.assertEqual(context.exception.status_code, 401)


class WebSocketTokenVerificationTest(unittest.TestCase):
    """Test WebSocket token verification"""

    def test_verify_ws_token_valid(self):
        """Test WebSocket token verification with valid token"""
        from escalada.auth import create_access_token, verify_ws_token
        
        data = {"sub": "wsuser"}
        token = create_access_token(data)
        
        result = verify_ws_token(token)
        self.assertEqual(result["sub"], "wsuser")
        self.assertIn("exp", result)  # Should have expiration

    def test_verify_ws_token_none(self):
        """Test WebSocket token verification with None token"""
        from escalada.auth import verify_ws_token
        
        with self.assertRaises(HTTPException) as context:
            verify_ws_token(None)
        self.assertEqual(context.exception.status_code, 401)
        self.assertIn("Missing", context.exception.detail)

    def test_verify_ws_token_empty_string(self):
        """Test WebSocket token verification with empty string"""
        from escalada.auth import verify_ws_token
        
        with self.assertRaises(HTTPException) as context:
            verify_ws_token("")
        self.assertEqual(context.exception.status_code, 401)

    def test_verify_ws_token_expired(self):
        """Test WebSocket token verification with expired token"""
        from escalada.auth import create_access_token, verify_ws_token
        
        data = {"sub": "wsuser"}
        expires_delta = timedelta(seconds=-1)
        token = create_access_token(data, expires_delta=expires_delta)
        
        with self.assertRaises(HTTPException) as context:
            verify_ws_token(token)
        self.assertEqual(context.exception.status_code, 401)


class SecretKeyTest(unittest.TestCase):
    """Test SECRET_KEY handling"""

    @patch.dict('os.environ', {'SECRET_KEY': 'test_secret_key_123'})
    def test_secret_key_from_environment(self):
        """Test that SECRET_KEY is read from environment"""
        # Reimport to pick up mocked environment
        import importlib
        import escalada.auth
        importlib.reload(escalada.auth)
        
        from escalada.auth import create_access_token
        
        data = {"sub": "testuser"}
        token = create_access_token(data)
        
        # Token should be created successfully with env secret
        self.assertIsNotNone(token)

    def test_secret_key_fallback(self):
        """Test that SECRET_KEY has fallback value"""
        from escalada.auth import create_access_token
        
        # Should work even without SECRET_KEY in env (uses fallback)
        data = {"sub": "testuser"}
        token = create_access_token(data)
        
        self.assertIsNotNone(token)


if __name__ == "__main__":
    unittest.main()
