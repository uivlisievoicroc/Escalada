import asyncio
import sys
import types
import unittest

# Stubs for optional runtime deps (fastapi/pydantic/starlette) so we can load the module in CI
fastapi_stub = types.ModuleType("fastapi")


class _DummyRouter:
    def post(self, *args, **kwargs):
        return lambda f: f

    def websocket(self, *args, **kwargs):
        return lambda f: f

    def get(self, *args, **kwargs):
        return lambda f: f


class _HTTPException(Exception):
    pass


fastapi_stub.APIRouter = _DummyRouter
fastapi_stub.HTTPException = _HTTPException
sys.modules["fastapi"] = fastapi_stub

pydantic_stub = types.ModuleType("pydantic")


class _DummyBaseModel:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

    def model_dump(self):
        return self.__dict__


pydantic_stub.BaseModel = _DummyBaseModel
sys.modules["pydantic"] = pydantic_stub

starlette_stub = types.ModuleType("starlette")
websockets_stub = types.ModuleType("starlette.websockets")


class _DummyWebSocket:
    pass


websockets_stub.WebSocket = _DummyWebSocket
sys.modules["starlette"] = starlette_stub
sys.modules["starlette.websockets"] = websockets_stub

from escalada.api.live import Cmd, cmd, state_map


class SubmitScoreTimeFallbackTest(unittest.TestCase):
    def setUp(self):
        state_map.clear()

    def test_submit_score_keeps_last_registered_time_when_missing(self):
        async def scenario():
            await cmd(
                Cmd(
                    boxId=1,
                    type="INIT_ROUTE",
                    routeIndex=1,
                    holdsCount=10,
                    competitors=[{"nume": "Alex", "marked": False}],
                )
            )
            await cmd(Cmd(boxId=1, type="REGISTER_TIME", registeredTime=12))
            await cmd(
                Cmd(
                    boxId=1,
                    type="SUBMIT_SCORE",
                    score=5,
                    competitor="Alex",
                    registeredTime=None,
                )
            )

        asyncio.run(scenario())
        self.assertEqual(state_map[1]["lastRegisteredTime"], 12)


if __name__ == "__main__":
    unittest.main()
