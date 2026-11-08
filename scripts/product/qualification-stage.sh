#!/bin/sh
# Sourced only by the isolated product qualifier and synthetic shell tests.
# Run each stage in its own subshell so traps and locals cannot alter its caller.
run_product_gate() (
  set -eu
  [ "$#" -ge 3 ] || exit 2
  gate_name=$1
  gate_deadline=$2
  shift 2
  case "$gate_name" in ''|*[!a-z0-9-]*) exit 2 ;; esac
  [ "${#gate_name}" -le 80 ] || exit 2
  # One second is reserved for the synthetic timeout regression; production
  # qualification always uses the explicit twenty/ninety-minute recipes.
  case "$gate_deadline" in 1s|20m|90m) ;; *) exit 2 ;; esac
  gate_log="/tmp/gk-g8s-$gate_name.log"
  gate_pid=
  gate_tail=
  cleanup_stage() {
    gate_status=$?
    trap - EXIT HUP INT TERM
    if [ -n "$gate_tail" ]; then
      kill -TERM "$gate_tail" 2>/dev/null || true
      wait "$gate_tail" 2>/dev/null || true
    fi
    if [ -n "$gate_pid" ]; then
      # GNU timeout forwards the signal to its supervised command group and
      # retains its own kill-after backstop. Never detach a cancelled test.
      kill -TERM "$gate_pid" 2>/dev/null || true
      wait "$gate_pid" 2>/dev/null || true
    fi
    exit "$gate_status"
  }
  trap cleanup_stage EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # Create before the reader starts; a fast process must not race log creation.
  : > "$gate_log"
  printf '\nG8S_QUAL_STAGE_START %s\n' "$gate_name"
  timeout --signal=TERM --kill-after=30s "$gate_deadline" "$@" >"$gate_log" 2>&1 &
  gate_pid=$!
  tail --pid="$gate_pid" -n +1 -f "$gate_log" &
  gate_tail=$!
  if wait "$gate_pid"; then gate_result=0; else gate_result=$?; fi
  gate_pid=
  if wait "$gate_tail"; then gate_log_result=0; else gate_log_result=$?; fi
  gate_tail=
  # A reader failure cannot hide a command failure or manufacture success.
  if [ "$gate_result" -eq 0 ] && [ "$gate_log_result" -ne 0 ]; then gate_result=1; fi
  printf 'G8S_QUAL_STAGE_END %s exit=%s\n' "$gate_name" "$gate_result"
  exit "$gate_result"
)
