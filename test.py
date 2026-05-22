import requests

USERNAME = "3830782921"
PASSWORD = "123abc"

# Test eInvoice
print("=== eInvoice ===")
r = requests.post(
    "https://einvoiceapi-demo.elogo.com.tr/token",
    data={"username": USERNAME, "password": PASSWORD, "grant_type": "password"}
)
print("Status:", r.status_code)
print("Response:", r.text[:500])

# Test eArchive
print("\n=== eArchive ===")
r = requests.post(
    "https://earchiveapi-demo.elogo.com.tr/token",
    data={"username": USERNAME, "password": PASSWORD, "grant_type": "password"}
)
print("Status:", r.status_code)
print("Response:", r.text[:500])