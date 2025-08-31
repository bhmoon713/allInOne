var app = new Vue({
    el: '#app',

    // computed values (camera
    computed: {
        ws_address: function() {
            return `${this.rosbridge_address}`
        },
    },
    // storing the state of the page
    data: {
        connected: false,
        ros: null,
        logs: [],
        loading: false,
        topic: null,
        message: null,
        rosbridge_address: 'wss://i-0b4248f1835ce837d.robotigniteacademy.com/3796eea1-797a-492e-bd2e-40c1536f1ceb/rosbridge/',
        port: '9090',
        
        // Robot Status (shown in sidebar)
        robotStatus: {
        speed: 0.0,                 // linear speed (m/s), from Twist or odom
        speedAngular: 0.0,          // angular speed (rad/s), from Twist or odom
        position: { x: 0.0, y: 0.0 },
        orientation: 0.0,           // yaw in degrees
        battery: 100,
        twistSub: null,
        odomSub: null,
        lastTwistAt: 0,
        lastOdomAt: 0,
        },
        // 2D stuff  
        mapRotated: false,
        mapViewer: null,
        mapGridClient: null,
        interval: null,

        // 3D stuff
        viewer: null,
        tfClient: null,
        urdfClient: null,

        // page content
        menu_title: 'Connection',
        // dragging data
        dragging: false,
        x: 'no',
        y: 'no',
        dragCircleStyle: {
            margin: '0px',
            top: '0px',
            left: '0px',
            display: 'none',
            width: '75px',
            height: '75px',
        },
        // joystick valules
        joystick: {
            vertical: 0,
            horizontal: 0,
        },
        // publisher
        pubInterval: null,
        buttonsOverride: false,
        manualLinear: 0,
        manualAngular: 0,
        // Navigation
        isNavigating: false,
        estopActive: false,

        // Topics
        cmdVelTopic: null,
        navGoalTopic: null,

            // Waypoints
        waypoints: {
        'sofa': { x: -2.63, y: -0.91, theta: 1.0, name: 'Sofa' },
        'living_room': { x: 1.41, y: -1.93, theta: 1.0, name: 'Living Room' },
        'kitchen': { x: 0.732, y: 2.53, theta: 1.0, name: 'Kitchen' }
        }

    },
    // helper methods to connect to ROS
    methods: {
        connect: function() {
            this.loading = true
            this.ros = new ROSLIB.Ros({
                url: this.rosbridge_address,
                groovyCompatibility: false
            })
            this.ros.on('connection', () => {
                this.logs.unshift((new Date()).toTimeString() + ' - Connected!')
                this.pubInterval = setInterval(this.publish, 100)
                this.connected = true
                this.loading = false
                this.setupROSCommunication();

                this.setup3DViewer()

                this.setCamera()            
                this.mapViewer = new ROS2D.Viewer({
                    divID: 'map',
                    width: 380,
                    height: 360
                });

                // Setup the map client.
                this.mapGridClient = new ROS2D.OccupancyGridClient({
                    ros: this.ros,
                    rootObject: this.mapViewer.scene,
                    continuous: true,
                });
                // Scale the canvas to fit to the map
                // Scale the canvas to fit to the map
                this.mapGridClient.on('change', () => {
                this.mapViewer.scaleToDimensions(
                    this.mapGridClient.currentGrid.width,
                    this.mapGridClient.currentGrid.height
                );
                this.mapViewer.shift(
                    this.mapGridClient.currentGrid.pose.position.x,
                    this.mapGridClient.currentGrid.pose.position.y
                );

                // Rotate canvas 90° CW once
                if (!this.mapRotated) {
                    const canvas = document.querySelector('#map canvas');
                    if (canvas) {
                    canvas.style.transform = 'rotate(90deg)';
                    canvas.style.transformOrigin = 'center center';
                    // optional: let the rotated canvas overflow the container
                    const mapDiv = document.getElementById('map');
                    if (mapDiv) mapDiv.style.overflow = 'visible';
                    this.mapRotated = true;
                    }
                }
                });

            })
            this.ros.on('error', (error) => {
                this.logs.unshift((new Date()).toTimeString() + ` - Error: ${error}`)
            })
            this.ros.on('close', () => {
                this.logs.unshift((new Date()).toTimeString() + ' - Disconnected!')
                this.connected = false
                this.loading = false
                this.unset3DViewer()
                clearInterval(this.pubInterval)
                document.getElementById('map').innerHTML = ''
                if (this.twistSub) this.twistSub.unsubscribe();
                if (this.odomSub)  this.odomSub.unsubscribe();
            })
        },
        
            publish: function () {
            const lin = this.buttonsOverride ? this.manualLinear  : this.joystick.vertical;
            const ang = this.buttonsOverride ? this.manualAngular : this.joystick.horizontal;

            let topic = new ROSLIB.Topic({
                ros: this.ros,
                name: '/fastbot_1/cmd_vel',
                messageType: 'geometry_msgs/msg/Twist' // unify to ROS 2 style
            });

            let message = new ROSLIB.Message({
                linear:  { x: lin, y: 0, z: 0 },
                angular: { x: 0, y: 0, z: -ang } // note the negate to keep right=+
            });
            topic.publish(message);
        },
        
        disconnect: function() {
            this.ros.close()
        },

        setTopic: function() {
            this.topic = new ROSLIB.Topic({
                ros: this.ros,
                name: '/fastbot_1/cmd_vel',
                messageType: 'geometry_msgs/msg/Twist'
            })
        },
        forward: function () {
        this.buttonsOverride = true;
        this.manualLinear = 0.2;
        this.manualAngular = 0.0;
        },

        backward: function () {
        this.buttonsOverride = true;
        this.manualLinear = -0.2;
        this.manualAngular = 0.0;
        },

        turnLeft: function () {
        this.buttonsOverride = true;
        this.manualLinear = 0.0;   // or 0.0 if you want pure rotation
        this.manualAngular = -0.5;
        },

        turnRight: function () {
        this.buttonsOverride = true;
        this.manualLinear = 0.0;   // or 0.0 if you want pure rotation
        this.manualAngular = +0.5;
        },

        stop: function () {
        this.buttonsOverride = false;
        this.manualLinear = 0.0;
        this.manualAngular = 0.0;
        },
        setCamera: function() {
            let without_wss = this.rosbridge_address.split('wss://')[1]
            console.log(without_wss)
            let domain = without_wss.split('/')[0] + '/' + without_wss.split('/')[1]
            console.log(domain)
            let host = domain + '/cameras'
            let viewer = new MJPEGCANVAS.Viewer({
                divID: 'divCamera',
                host: host,
                width: 500,
                height: 360,
                topic: '/fastbot_1/camera/image_raw',
                ssl: true,
            })
        },
        // joystick related
        sendCommand: function() {
            let topic = new ROSLIB.Topic({
                ros: this.ros,
                name: '/fastbot_1/cmd_vel',
                messageType: 'geometry_msgs/msg/Twist'
            })
            let message = new ROSLIB.Message({
                linear: { x: 0.2, y: 0, z: 0, },
                angular: { x: 0, y: 0, z: 0.5, },
            })
            topic.publish(message)
        },
        startDrag() {
            this.dragging = true
            this.x = this.y = 0
        },
        stopDrag() {
            this.dragging = false
            this.x = this.y = 'no'
            this.dragCircleStyle.display = 'none'
            this.resetJoystickVals()
        },
        doDrag(event) {
            if (this.dragging) {
                this.x = event.offsetX
                this.y = event.offsetY
                let ref = document.getElementById('dragstartzone')
                this.dragCircleStyle.display = 'inline-block'

                let minTop = ref.offsetTop - parseInt(this.dragCircleStyle.height) / 2
                let maxTop = minTop + 200
                let top = this.y + minTop
                this.dragCircleStyle.top = `${top}px`

                let minLeft = ref.offsetLeft - parseInt(this.dragCircleStyle.width) / 2
                let maxLeft = minLeft + 200
                let left = this.x + minLeft
                this.dragCircleStyle.left = `${left}px`

                this.setJoystickVals()
            }
        },
        setJoystickVals() {
            this.joystick.vertical = -1 * ((this.y / 200) - 0.5)
            this.joystick.horizontal = +1 * ((this.x / 200) - 0.5)
        },
        resetJoystickVals() {
            this.joystick.vertical = 0
            this.joystick.horizontal = 0
        },

        setup3DViewer() {
            this.viewer = new ROS3D.Viewer({
                background: '#cccccc',
                divID: 'div3DViewer',
                width: 340,
                height: 280,
                antialias: true,
                fixedFrame: 'fastbot_1/odom'
            })

            // Add a grid.
            this.viewer.addObject(new ROS3D.Grid({
                color:'#0181c4',
                cellSize: 0.5,
                num_cells: 20
            }))

            // Setup a client to listen to TFs.
            this.tfClient = new ROSLIB.TFClient({
                ros: this.ros,
                angularThres: 0.01,
                transThres: 0.01,
                rate: 10.0,
                fixedFrame: 'fastbot_1_base_link'
            })

            // Setup the URDF client.
            this.urdfClient = new ROS3D.UrdfClient({
                ros: this.ros,
                param: '/fastbot_1_robot_state_publisher:robot_description',
                tfClient: this.tfClient,
                // We use "path: location.origin + location.pathname"
                // instead of "path: window.location.href" to remove query params,
                // otherwise the assets fail to load
                path: location.origin + location.pathname,
                rootObject: this.viewer.scene,
                loader: ROS3D.COLLADA_LOADER_2
            })
        },
        unset3DViewer() {
            document.getElementById('div3DViewer').innerHTML = ''
        },

        setupROSCommunication: function () {
        // Twist subscriber → linear & angular speeds
        this.twistSub = new ROSLIB.Topic({
            ros: this.ros,
            name: '/fastbot_1/cmd_vel',                 // change if your topic differs
            messageType: 'geometry_msgs/msg/Twist'      // ROS 2 type
        });
        this.twistSub.subscribe((msg) => {
            // Speed straight from commanded Twist
            this.robotStatus.speed        = Number((msg.linear  && msg.linear.x)  || 0);
            this.robotStatus.speedAngular = Number((msg.angular && msg.angular.z) || 0);
            this.lastTwistAt = Date.now();
        });

        // Odometry subscriber → position (x,y) and yaw (deg)
        this.odomSub = new ROSLIB.Topic({
            ros: this.ros,
            name: '/fastbot_1/odom',                    // or '/odometry/filtered' if that’s what you use
            messageType: 'nav_msgs/msg/Odometry'
        });
        this.odomSub.subscribe((odom) => {
            const p = odom.pose.pose.position;
            const q = odom.pose.pose.orientation;

            // position
            this.robotStatus.position = {
            x: Number(p && p.x || 0),
            y: Number(p && p.y || 0)
            };

            // yaw (rad → deg) from quaternion
            const siny_cosp = 2 * ((q.w||0) * (q.z||0) + (q.x||0) * (q.y||0));
            const cosy_cosp = 1 - 2 * ((q.y||0) * (q.y||0) + (q.z||0) * (q.z||0));
            const yaw = Math.atan2(siny_cosp, cosy_cosp);            // radians
            this.robotStatus.orientation = (yaw * 180) / Math.PI;    // degrees

            this.lastOdomAt = Date.now();
        });
        // Publish nav goals
        this.navGoalTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/goal_pose',
            messageType: 'geometry_msgs/msg/PoseStamped'
        });

        // (Re)use for E-stop zeroing
        this.cmdVelTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/fastbot_1/cmd_vel',
            messageType: 'geometry_msgs/msg/Twist'
        });
        },

        goToWaypoint(waypointKey) {
        if (!this.connected || !this.navGoalTopic) return;

        const wp = this.waypoints[waypointKey];
        this.isNavigating = true;
        this.controlMode = 'Navigation to ' + wp.name;

        const now = Date.now();
        const sec = Math.floor(now / 1000);
        const nsec = (now % 1000) * 1e6;

        // yaw -> quaternion (z,w) for planar nav
        const half = wp.theta / 2.0;
        const qz = Math.sin(half);
        const qw = Math.cos(half);

        const goal = new ROSLIB.Message({
            header: { frame_id: 'map', stamp: { sec, nanosec: nsec } },
            pose: {
            position: { x: wp.x, y: wp.y, z: 0.0 },
            orientation: { x: 0.0, y: 0.0, z: qz, w: qw }
            }
        });

        this.navGoalTopic.publish(goal);

        // simple demo timeout to re-enable buttons
        setTimeout(() => {
            this.isNavigating = false;
            this.controlMode = 'Manual';
        }, 5000);
        },

        emergencyStop() {
        if (!this.connected || !this.cmdVelTopic) return;

        this.estopActive = true;
        this.isNavigating = false;
        this.controlMode = 'EMERGENCY STOP';

        const zero = new ROSLIB.Message({
            linear:  { x: 0, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 }
        });

        // publish zeros for ~1s @20Hz
        let count = 0;
        const t = setInterval(() => {
            this.cmdVelTopic.publish(zero);
            if (++count >= 20) {
            clearInterval(t);
            this.estopActive = false;
            this.controlMode = 'Manual';
            }
        }, 50);
        },




    },
    mounted() {
        window.addEventListener('mouseup', this.stopDrag)
        this.interval = setInterval(() => {
            if (this.ros != null && this.ros.isConnected) {
                this.ros.getNodes((data) => { }, (error) => { })
            }
        }, 10000)
    },
})