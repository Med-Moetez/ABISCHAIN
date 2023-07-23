- create a new redis .conf file

```Bash
$ cp /etc/redis/6379.conf /etc/redis/6380.conf
```

- edit /etc/redis/6380.conf, illustrated as below

```Bash
...
#modify pidfile
#pidfile /var/run/redis/redis_6379.pid
pidfile /var/run/redis/redis_6380.pid

...
#modify port
#port 6379
port 6380

...
#modify logfile
#logfile /var/log/redis/redis_6379.log
logfile /var/log/redis/redis_6380.log

...
#modify vm-swap-file
#vm-swap-file /tmp/redis_6379.swap
vm-swap-file /tmp/redis_6380.swap
...
```

\*copy /var/lib/redis/6379

```
cp -r /var/lib/redis/6379 /var/lib/redis/6380
```

- copy init script

```Bash
$ cp /etc/init.d/redis_6379 /etc/init.d/redis_6380
```

- edit the new init script

```Bash
...

#pidfile="/var/run/redis/redis_6379.pid"
pidfile="/var/run/redis/redis_6380.pid"

...

#REDIS_CONFIG="/etc/redis/6379.conf"
REDIS_CONFIG="/etc/redis/6380.conf"

...
```

- start redis_6380 server

```Bash
$ sudo redis_server /etc/redis/6380.conf
```

- start redis-cli

```Bash
$ redis-cli -p 6380
```
