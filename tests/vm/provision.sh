# Runs once per warm slot (as root): a user systemd manager for the test user, as on a desktop login.
set -eu
loginctl enable-linger tester
