"""Deterministic bench simulator.

The simulator exists so the console can be reviewed without hardware. It is
always labelled SIMULATOR in the UI, exports and diagnostics, and it never
backs live hardware: the serial path is the only way to reach a real machine.

The state machine mirrors the firmware, including the rule that the guard only
unlocks after the standstill check passes.
"""
import math


class DemoMachine:
    IDLE = 'IDLE'
    RUNNING = 'RUNNING'
    STOPPING = 'STOPPING'
    UNLOCKED = 'UNLOCKED'

    def __init__(self, seq=0):
        self.seq = seq
        self.state = self.IDLE
        self.since = 0.0
        self.lock = 'LOCKED'   # RELEASED only after a verified standstill
        self.level = 0.0          # simulated rotational energy, 0..1
        self.verified = False     # a stop has been verified since boot
        self.presented = None
        self.commands = []

    # -- operator interface -------------------------------------------
    def command(self, action, at):
        # Mirrors the firmware: a start is only accepted from idle, never while
        # the guard is released for access.
        if action == 'MOTOR_ON' and self.state == self.IDLE:
            self.state = self.RUNNING
            self.lock = 'LOCKED'      # a start re-locks the guard
            self.since = at
            self.commands.append((at, action))
            return True, 'Motor energised'
        if action == 'MOTOR_OFF' and self.state == self.RUNNING:
            self.state = self.STOPPING
            self.since = at
            self.verified = False
            self.commands.append((at, action))
            return True, 'Motor de-energised; verifying standstill'
        return False, 'Command not valid in the current state'

    def present_card(self, ref):
        self.presented = ref

    # -- frame generation --------------------------------------------
    def step(self, at, dt):
        if self.state == self.RUNNING:
            self.level = min(1.0, self.level + dt * 1.4)
        elif self.state == self.STOPPING:
            self.level = max(0.0, self.level - dt * .5)
            if self.level <= 0.02:
                self.level = 0.0
                self.verified = True
                self.state = self.UNLOCKED
                self.lock = 'RELEASED'   # release follows verified standstill
                self.since = at
        elif self.state == self.UNLOCKED and at - self.since > 8:
            # The simulated door is closed and latched again after eight
            # seconds. Until then the console shows the guard as released and
            # "safe to open", and a start is refused.
            self.state = self.IDLE
            self.lock = 'LOCKED'
            self.since = at

        running = self.state in (self.RUNNING, self.STOPPING)
        motor = {'IDLE': 'STOPPED', 'RUNNING': 'RUNNING',
                 'STOPPING': 'STOPPING', 'UNLOCKED': 'STOPPED'}[self.state]
        standstill = ('VERIFIED' if (self.verified and not running)
                      else 'VERIFYING' if self.state == self.STOPPING
                      else 'NOT_VERIFIED')
        guard = 'OPEN' if self.state == self.UNLOCKED and at - self.since > 1.5 else 'CLOSED'
        adc = int(round(620 * self.level + 4 + 3 * math.sin(at * 3.1))) if self.level else 3 + int(at) % 3
        self.seq += 1
        # The simulator stands in for a *fully fitted* machine so the intended
        # release sequence can be reviewed. Real hardware reports its own
        # guard_fitted / lock_fitted flags, and the console warns when they are
        # false.
        telemetry = dict(v=1, type='telemetry', seq=self.seq, device='prooflock-uno-sim',
                         firmware='demo-2.0', motor=motor, guard_a=guard, guard_b=guard,
                         lock=self.lock, standstill=standstill, back_emf_adc=adc,
                         guard_fitted=True, lock_fitted=True)
        frames = []
        if self.presented:
            frames.append(dict(v=1, type='rfid', seq=self.seq, result='ACCEPTED',
                               operator_ref=self.presented))
            self.presented = None
            self.seq += 1
            telemetry['seq'] = self.seq
        frames.append(telemetry)
        return frames
