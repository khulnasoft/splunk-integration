import json
import os
import splunk
import sys

from urllib import parse


sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "vendor"))
from khulnasoft import KhulnasoftAPI
from logger import Logger


class KhulnasoftValidateApiKey(splunk.rest.BaseRestHandler):
    def handle_POST(self) -> None:
        payload = self.request["payload"]
        params = parse.parse_qs(payload)

        if "apiKey" not in params:
            raise Exception("API Key is required")

        khulnasoft_api = KhulnasoftAPI(api_key=params["apiKey"][0])
        khulnasoft_api.fetch_api_key_validation()
        self.response.setHeader("Content-Type", "application/json")
        self.response.write(json.dumps({}))


class KhulnasoftUserTenants(splunk.rest.BaseRestHandler):
    def handle_POST(self) -> None:
        logger = Logger(class_name=__file__)
        payload = self.request["payload"]
        params = parse.parse_qs(payload)

        if "apiKey" not in params:
            raise Exception("API Key is required")

        khulnasoft_api = KhulnasoftAPI(api_key=params["apiKey"][0])
        response = khulnasoft_api.fetch_tenants()
        response_json = response.json()
        logger.debug(f"KhulnasoftUserTenants: {response_json}")
        self.response.setHeader("Content-Type", "application/json")
        self.response.write(json.dumps(response_json))


class KhulnasoftSeverityFilters(splunk.rest.BaseRestHandler):
    def handle_POST(self) -> None:
        logger = Logger(class_name=__file__)
        payload = self.request["payload"]
        params = parse.parse_qs(payload)

        if "apiKey" not in params:
            raise Exception("API Key is required")

        khulnasoft_api = KhulnasoftAPI(api_key=params["apiKey"][0])
        response = khulnasoft_api.fetch_filters_severity()
        response_json = response.json()
        logger.debug(f"KhulnasoftSeverityFilters: {response_json}")
        self.response.setHeader("Content-Type", "application/json")
        self.response.write(json.dumps(response_json))


class KhulnasoftSourceTypeFilters(splunk.rest.BaseRestHandler):
    def handle_POST(self) -> None:
        logger = Logger(class_name=__file__)
        payload = self.request["payload"]
        params = parse.parse_qs(payload)

        if "apiKey" not in params:
            raise Exception("API Key is required")

        khulnasoft_api = KhulnasoftAPI(api_key=params["apiKey"][0])
        response = khulnasoft_api.fetch_filters_source_type()
        response_json = response.json()
        logger.debug(f"KhulnasoftSourceTypeFilters: {response_json}")
        self.response.setHeader("Content-Type", "application/json")
        self.response.write(json.dumps(response_json))
