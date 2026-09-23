"""Print a scrypt password hash for APP_PASSWORD_HASH in server/.env."""

import getpass

from server.passwords import hash_password


def main() -> None:
    password = getpass.getpass('New app password: ')
    confirmation = getpass.getpass('Confirm app password: ')
    if not password or password != confirmation:
        raise SystemExit('Passwords must be non-empty and match.')
    print(hash_password(password))


if __name__ == '__main__':
    main()
